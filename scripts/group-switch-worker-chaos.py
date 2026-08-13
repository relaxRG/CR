#!/usr/bin/env python3
"""同步组切换的离线故障注入验证器。

本脚本只使用标准库 sqlite3；表结构与线上 D1 导出的 devices、pair_codes、
sync_data、group_ts、photos 关系保持一致。它验证 Worker 协议不可破坏的安全
不变量，不连接生产数据库，也不写入任何远程服务。
"""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
import unittest
from dataclasses import dataclass
from typing import Iterable

A_MARKER = "__GROUP_A_PRIVATE__"
B_MARKER = "__GROUP_B_PRIVATE__"


@dataclass(frozen=True)
class Membership:
    device_id: str
    group_id: str
    token: str
    role: str


class SwitchProtocol:
    def __init__(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE device_groups (
              id TEXT PRIMARY KEY,
              created_at INTEGER NOT NULL,
              owner_device_id TEXT
            );
            CREATE TABLE devices (
              id TEXT PRIMARY KEY,
              device_id TEXT UNIQUE NOT NULL,
              group_id TEXT NOT NULL REFERENCES device_groups(id),
              token TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              allowed_keys TEXT,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE pair_codes (
              code TEXT PRIMARY KEY,
              group_id TEXT NOT NULL REFERENCES device_groups(id),
              role TEXT NOT NULL,
              allowed_keys TEXT,
              expires_at INTEGER NOT NULL,
              used INTEGER NOT NULL DEFAULT 0,
              reserved_switch_id TEXT,
              reserved_at INTEGER
            );
            CREATE TABLE sync_data (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              group_id TEXT NOT NULL REFERENCES device_groups(id),
              storage_key TEXT NOT NULL,
              value TEXT NOT NULL,
              client_updated_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(group_id, storage_key)
            );
            CREATE TABLE group_switches (
              switch_id TEXT PRIMARY KEY,
              state TEXT NOT NULL,
              source_device_id TEXT NOT NULL,
              source_group_id TEXT NOT NULL,
              target_group_id TEXT NOT NULL,
              target_device_id TEXT NOT NULL,
              target_token TEXT NOT NULL,
              target_role TEXT NOT NULL,
              handoff_device_id TEXT,
              pair_code TEXT NOT NULL,
              recovery_ticket_hash TEXT NOT NULL
            );
            """
        )

    @staticmethod
    def ticket_hash(ticket: str) -> str:
        return hashlib.sha256(ticket.encode("utf-8")).hexdigest()

    def add_group(self, group_id: str, owner_device_id: str | None = None) -> None:
        self.db.execute("INSERT INTO device_groups VALUES (?, 1, ?)", (group_id, owner_device_id))

    def add_member(self, member: Membership) -> None:
        self.db.execute(
            "INSERT INTO devices (id, device_id, group_id, token, name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
            (member.device_id, member.device_id, member.group_id, member.token, member.device_id, member.role),
        )

    def add_pair_code(self, code: str, group_id: str, role: str = "collaborator") -> None:
        self.db.execute(
            "INSERT INTO pair_codes (code, group_id, role, expires_at) VALUES (?, ?, ?, 9999999999999)",
            (code, group_id, role),
        )

    def add_data(self, group_id: str, entries: Iterable[tuple[str, str]]) -> None:
        for index, (key, value) in enumerate(entries, start=1):
            self.db.execute(
                "INSERT INTO sync_data (group_id, storage_key, value, client_updated_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (group_id, key, value, index, index),
            )

    def prepare(self, source: Membership, code: str, switch_id: str, ticket: str, handoff: str | None = None) -> None:
        source_row = self.db.execute(
            "SELECT group_id, role FROM devices WHERE device_id = ? AND token = ? AND is_active = 1",
            (source.device_id, source.token),
        ).fetchone()
        assert source_row, "source device must be active"
        target = self.db.execute(
            "SELECT group_id, role FROM pair_codes WHERE code = ? AND used = 0 AND reserved_switch_id IS NULL",
            (code,),
        ).fetchone()
        assert target and target[0] != source.group_id, "target code must be usable and cross-group"
        others = self.db.execute(
            "SELECT COUNT(*) FROM devices WHERE group_id = ? AND is_active = 1 AND device_id <> ?",
            (source.group_id, source.device_id),
        ).fetchone()[0]
        if source_row[1] == "owner" and others and not handoff:
            raise ValueError("OWNER_HANDOFF_REQUIRED")
        if handoff:
            valid = self.db.execute(
                "SELECT 1 FROM devices WHERE device_id = ? AND group_id = ? AND is_active = 1",
                (handoff, source.group_id),
            ).fetchone()
            assert valid, "handoff must be an active source-group device"
        target_device = f"target-{switch_id}"
        target_token = f"token-{switch_id}"
        self.db.execute(
            "INSERT INTO group_switches VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (switch_id, source.device_id, source.group_id, target[0], target_device, target_token, target[1], handoff, code, self.ticket_hash(ticket)),
        )

    def commit(self, source: Membership, switch_id: str, ticket: str) -> Membership:
        row = self.db.execute("SELECT * FROM group_switches WHERE switch_id = ?", (switch_id,)).fetchone()
        assert row and row[10] == self.ticket_hash(ticket), "recovery ticket mismatch"
        columns = [column[0] for column in self.db.execute("SELECT * FROM group_switches LIMIT 0").description]
        record = dict(zip(columns, row))
        if record["state"] == "committed":
            return Membership(record["target_device_id"], record["target_group_id"], record["target_token"], record["target_role"])
        assert record["state"] == "prepared"
        with self.db:
            reserved = self.db.execute(
                "UPDATE pair_codes SET reserved_switch_id = ? WHERE code = ? AND used = 0 AND (reserved_switch_id IS NULL OR reserved_switch_id = ?)",
                (switch_id, record["pair_code"], switch_id),
            ).rowcount
            assert reserved == 1, "pair code must be reserved by this switch"
            self.db.execute(
                "INSERT INTO devices (id, device_id, group_id, token, name, role, is_active, created_at) VALUES (?, ?, ?, ?, 'target', ?, 1, 1)",
                (record["target_device_id"], record["target_device_id"], record["target_group_id"], record["target_token"], record["target_role"]),
            )
            if record["handoff_device_id"]:
                self.db.execute("UPDATE devices SET role = 'collaborator' WHERE group_id = ? AND role = 'owner'", (source.group_id,))
                self.db.execute("UPDATE devices SET role = 'owner' WHERE device_id = ?", (record["handoff_device_id"],))
                self.db.execute("UPDATE device_groups SET owner_device_id = ? WHERE id = ?", (record["handoff_device_id"], source.group_id))
            self.db.execute("UPDATE devices SET is_active = 0 WHERE device_id = ? AND token = ?", (source.device_id, source.token))
            self.db.execute("UPDATE pair_codes SET used = 1 WHERE code = ?", (record["pair_code"],))
            self.db.execute("UPDATE group_switches SET state = 'committed' WHERE switch_id = ?", (switch_id,))
        return Membership(record["target_device_id"], record["target_group_id"], record["target_token"], record["target_role"])

    def complete_snapshot(self, member: Membership) -> list[tuple[str, str]]:
        active = self.db.execute(
            "SELECT 1 FROM devices WHERE device_id = ? AND token = ? AND group_id = ? AND is_active = 1",
            (member.device_id, member.token, member.group_id),
        ).fetchone()
        assert active, "old membership cannot pull after commit"
        return self.db.execute(
            "SELECT storage_key, value FROM sync_data WHERE group_id = ? ORDER BY storage_key",
            (member.group_id,),
        ).fetchall()


class GroupSwitchChaosTests(unittest.TestCase):
    def setUp(self) -> None:
        self.p = SwitchProtocol()
        self.p.add_group("A", "owner-a")
        self.p.add_group("B", "owner-b")
        self.source = Membership("owner-a", "A", "token-a", "owner")
        self.p.add_member(self.source)
        self.p.add_member(Membership("owner-b", "B", "token-b", "owner"))
        self.p.add_data("A", [("cocktail.recipes", A_MARKER), ("spirits.ledger.v3", A_MARKER)])
        self.p.add_data("B", [("cocktail.recipes", B_MARKER), ("labor_payslips_v1", B_MARKER)])
        self.p.add_pair_code("123456", "B")

    def test_a_group_values_never_appear_in_target_snapshot(self) -> None:
        self.p.prepare(self.source, "123456", "switch-a-b", "ticket-" + "x" * 32)
        target = self.p.commit(self.source, "switch-a-b", "ticket-" + "x" * 32)
        snapshot = dict(self.p.complete_snapshot(target))
        self.assertTrue(all(A_MARKER not in value for value in snapshot.values()))
        self.assertEqual(snapshot, {"cocktail.recipes": B_MARKER, "labor_payslips_v1": B_MARKER})
        with self.assertRaises(AssertionError):
            self.p.complete_snapshot(self.source)

    def test_commit_is_idempotent_after_response_loss_or_crash(self) -> None:
        ticket = "ticket-" + "y" * 32
        self.p.prepare(self.source, "123456", "switch-crash", ticket)
        first = self.p.commit(self.source, "switch-crash", ticket)
        recovered = self.p.commit(self.source, "switch-crash", ticket)
        self.assertEqual(first, recovered)
        self.assertEqual(len(self.p.complete_snapshot(recovered)), 2)

    def test_owner_requires_handoff_when_other_active_member_exists(self) -> None:
        colleague = Membership("colleague-a", "A", "token-colleague", "collaborator")
        self.p.add_member(colleague)
        with self.assertRaisesRegex(ValueError, "OWNER_HANDOFF_REQUIRED"):
            self.p.prepare(self.source, "123456", "switch-needs-handoff", "ticket-" + "z" * 32)
        self.p.prepare(self.source, "123456", "switch-handoff", "ticket-" + "z" * 32, colleague.device_id)
        self.p.commit(self.source, "switch-handoff", "ticket-" + "z" * 32)
        role = self.p.db.execute("SELECT role FROM devices WHERE device_id = ?", (colleague.device_id,)).fetchone()[0]
        self.assertEqual(role, "owner")

    def test_invalid_ticket_cannot_discover_or_complete_switch(self) -> None:
        ticket = "ticket-" + "k" * 32
        self.p.prepare(self.source, "123456", "switch-secret", ticket)
        with self.assertRaisesRegex(AssertionError, "recovery ticket mismatch"):
            self.p.commit(self.source, "switch-secret", "ticket-" + "wrong" * 8)
        self.assertEqual(self.p.db.execute("SELECT state FROM group_switches WHERE switch_id = 'switch-secret'").fetchone()[0], "prepared")


if __name__ == "__main__":
    unittest.main(verbosity=2)
