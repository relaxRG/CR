/**
 * 供应商档案管理页（Build 119B）
 * 功能：新增/编辑供应商、银行卡管理、一键复制付款信息
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Clipboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import {
  Supplier, SupplierCategory, SupplierBankAccount,
  SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_COLORS,
  maskCardNumber, generatePaymentCopyText,
} from "@/lib/store/monthly-summary/types";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const CATEGORY_OPTIONS: SupplierCategory[] = ["wine","spirits","beer","ice","food","equipment","other"];

// ─── 供应商表单 Modal ──────────────────────────────────────────────────────────
function SupplierFormModal({ visible, supplier, colors, onSave, onClose }: {
  visible: boolean;
  supplier: Supplier | null;
  colors: any;
  onSave: (data: Omit<Supplier, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [name, setName] = useState(supplier?.name ?? "");
  const [nameEn, setNameEn] = useState(supplier?.nameEn ?? "");
  const [category, setCategory] = useState<SupplierCategory>(supplier?.category ?? "wine");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(supplier?.contactPhone ?? "");
  const [paymentTerms, setPaymentTerms] = useState(supplier?.paymentTerms ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");

  React.useEffect(() => {
    if (visible) {
      setName(supplier?.name ?? "");
      setNameEn(supplier?.nameEn ?? "");
      setCategory(supplier?.category ?? "wine");
      setContactName(supplier?.contactName ?? "");
      setContactPhone(supplier?.contactPhone ?? "");
      setPaymentTerms(supplier?.paymentTerms ?? "");
      setNotes(supplier?.notes ?? "");
    }
  }, [visible, supplier]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写供应商名称"); return; }
    onSave({
      name: name.trim(), nameEn: nameEn.trim(), category,
      contactName: contactName.trim(), contactPhone: contactPhone.trim(),
      paymentTerms: paymentTerms.trim(), bankAccounts: supplier?.bankAccounts ?? [],
      notes: notes.trim(), active: true,
    });
    onClose();
  };

  const catColor = SUPPLIER_CATEGORY_COLORS[category];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[FM.sheet, { backgroundColor: colors.background }]}>
          <View style={[FM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[FM.title, { color: colors.foreground }]}>{supplier ? "编辑供应商" : "新增供应商"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <SectionCard title="基本信息" colors={colors}>
              <FormRow label="供应商名称" required colors={colors}>
                <TextInput value={name} onChangeText={setName} placeholder="如 甘澧、至缘"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="英文名（可选）" colors={colors}>
                <TextInput value={nameEn} onChangeText={setNameEn} placeholder="如 Interprocom"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="品类" colors={colors}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {CATEGORY_OPTIONS.map((c) => {
                    const cc = SUPPLIER_CATEGORY_COLORS[c];
                    const sel = category === c;
                    return (
                      <TouchableOpacity key={c} onPress={() => { tap(); setCategory(c); }}
                        style={[FM.chip, { backgroundColor: sel ? cc : colors.surface, borderColor: sel ? cc : colors.border }]}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: sel ? "#fff" : cc }}>
                          {SUPPLIER_CATEGORY_LABELS[c]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </FormRow>
            </SectionCard>
            <SectionCard title="联系信息" colors={colors}>
              <FormRow label="联系人" colors={colors}>
                <TextInput value={contactName} onChangeText={setContactName} placeholder="联系人姓名"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="联系电话" colors={colors}>
                <TextInput value={contactPhone} onChangeText={setContactPhone} placeholder="手机号"
                  keyboardType="phone-pad" placeholderTextColor={colors.muted}
                  style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="付款周期" colors={colors}>
                <TextInput value={paymentTerms} onChangeText={setPaymentTerms} placeholder="如 20号前付、月结30天"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
            </SectionCard>
            <SectionCard title="备注" colors={colors}>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注信息"
                multiline numberOfLines={3} placeholderTextColor={colors.muted}
                style={[FM.input, { color: colors.foreground, borderColor: colors.border, height: 72, textAlignVertical: "top" }]} />
            </SectionCard>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 银行卡表单 Modal ─────────────────────────────────────────────────────────
function BankAccountModal({ visible, account, colors, onSave, onClose }: {
  visible: boolean;
  account: SupplierBankAccount | null;
  colors: any;
  onSave: (data: Omit<SupplierBankAccount, "id">) => void;
  onClose: () => void;
}) {
  const [accountName, setAccountName] = useState(account?.accountName ?? "");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [cardNumber, setCardNumber] = useState(account?.cardNumber ?? "");
  const [note, setNote] = useState(account?.note ?? "");
  const [isDefault, setIsDefault] = useState(account?.isDefault ?? false);

  React.useEffect(() => {
    if (visible) {
      setAccountName(account?.accountName ?? "");
      setBankName(account?.bankName ?? "");
      setCardNumber(account?.cardNumber ?? "");
      setNote(account?.note ?? "");
      setIsDefault(account?.isDefault ?? false);
    }
  }, [visible, account]);

  const handleSave = () => {
    if (!accountName.trim()) { Alert.alert("请填写账户名"); return; }
    if (!bankName.trim()) { Alert.alert("请填写银行名称"); return; }
    if (!cardNumber.trim()) { Alert.alert("请填写银行卡号"); return; }
    onSave({ accountName: accountName.trim(), bankName: bankName.trim(), cardNumber: cardNumber.trim(), note: note.trim(), isDefault });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[FM.sheet, { backgroundColor: colors.background }]}>
          <View style={[FM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[FM.title, { color: colors.foreground }]}>{account ? "编辑银行卡" : "新增银行卡"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <SectionCard title="账户信息" colors={colors}>
              <FormRow label="账户名（收款人）" required colors={colors}>
                <TextInput value={accountName} onChangeText={setAccountName} placeholder="收款人姓名/公司名"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="银行名称" required colors={colors}>
                <TextInput value={bankName} onChangeText={setBankName} placeholder="如 招商银行、工商银行"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="银行卡号" required colors={colors}>
                <TextInput value={cardNumber} onChangeText={setCardNumber} placeholder="完整卡号"
                  keyboardType="number-pad" placeholderTextColor={colors.muted}
                  style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <FormRow label="备注" colors={colors}>
                <TextInput value={note} onChangeText={setNote} placeholder="如 对公账户、个人账户"
                  placeholderTextColor={colors.muted} style={[FM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
              <TouchableOpacity onPress={() => setIsDefault(!isDefault)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
                <View style={[FM.checkbox, { borderColor: isDefault ? colors.primary : colors.border, backgroundColor: isDefault ? colors.primary : "transparent" }]}>
                  {isDefault && <IconSymbol name="checkmark" size={12} color="#fff" />}
                </View>
                <Text style={{ fontSize: 14, color: colors.foreground }}>设为默认账户</Text>
              </TouchableOpacity>
            </SectionCard>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 供应商详情页 ─────────────────────────────────────────────────────────────
function SupplierDetail({ supplier, colors, onEdit, onBack, onAddBank, onEditBank, onDeleteBank, onCopy }: {
  supplier: Supplier; colors: any;
  onEdit: () => void; onBack: () => void;
  onAddBank: () => void;
  onEditBank: (acc: SupplierBankAccount) => void;
  onDeleteBank: (accId: string) => void;
  onCopy: (text: string) => void;
}) {
  const catColor = SUPPLIER_CATEGORY_COLORS[supplier.category];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* 基本信息卡 */}
      <View style={[S.card, { backgroundColor: colors.surface, borderColor: catColor + "33", borderLeftColor: catColor, borderLeftWidth: 3 }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>{supplier.name}</Text>
              {supplier.nameEn ? <Text style={{ fontSize: 13, color: colors.muted }}>{supplier.nameEn}</Text> : null}
            </View>
            <View style={[S.catTag, { backgroundColor: catColor + "15", borderColor: catColor + "33" }]}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: catColor }}>{SUPPLIER_CATEGORY_LABELS[supplier.category]}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onEdit} style={[S.editBtn, { borderColor: colors.border }]}>
            <IconSymbol name="pencil" size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, color: colors.primary }}>编辑</Text>
          </TouchableOpacity>
        </View>
        {supplier.contactName ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
            <IconSymbol name="person.crop.circle.fill" size={14} color={colors.muted} />
            <Text style={{ fontSize: 13, color: colors.muted }}>{supplier.contactName}</Text>
            {supplier.contactPhone ? <Text style={{ fontSize: 13, color: colors.muted }}>· {supplier.contactPhone}</Text> : null}
          </View>
        ) : null}
        {supplier.paymentTerms ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
            <IconSymbol name="calendar" size={14} color={colors.muted} />
            <Text style={{ fontSize: 13, color: colors.muted }}>{supplier.paymentTerms}</Text>
          </View>
        ) : null}
        {supplier.notes ? (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 18 }}>{supplier.notes}</Text>
        ) : null}
      </View>

      {/* 银行卡列表 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>收款账户</Text>
        <TouchableOpacity onPress={onAddBank}
          style={[S.addBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
          <IconSymbol name="plus" size={14} color={colors.primary} />
          <Text style={{ fontSize: 13, color: colors.primary }}>添加账户</Text>
        </TouchableOpacity>
      </View>

      {supplier.bankAccounts.length === 0 ? (
        <View style={[S.emptyBank, { borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, color: colors.muted }}>暂无收款账户，点击上方添加</Text>
        </View>
      ) : (
        supplier.bankAccounts.map((acc) => (
          <BankCard key={acc.id} account={acc} colors={colors}
            onEdit={() => onEditBank(acc)}
            onDelete={() => Alert.alert("删除账户", `确认删除 ${acc.bankName} 账户？`, [
              { text: "取消", style: "cancel" },
              { text: "删除", style: "destructive", onPress: () => onDeleteBank(acc.id) },
            ])}
            onCopy={(amount?: number) => {
              const text = generatePaymentCopyText({
                recipientName: acc.accountName,
                bankName: acc.bankName,
                cardNumber: acc.cardNumber,
                amount: amount ?? 0,
              });
              onCopy(text);
            }}
          />
        ))
      )}
    </ScrollView>
  );
}

// ─── 银行卡展示组件 ───────────────────────────────────────────────────────────
function BankCard({ account, colors, onEdit, onDelete, onCopy }: {
  account: SupplierBankAccount; colors: any;
  onEdit: () => void; onDelete: () => void; onCopy: (amount?: number) => void;
}) {
  const [showCopyAmount, setShowCopyAmount] = useState(false);
  const [copyAmount, setCopyAmount] = useState("");

  return (
    <View style={[S.bankCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {account.isDefault && (
        <View style={[S.defaultTag, { backgroundColor: colors.primary + "15" }]}>
          <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "700" }}>默认</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[S.bankIcon, { backgroundColor: "#007AFF15" }]}>
          <IconSymbol name="creditcard.fill" size={18} color="#007AFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{account.accountName}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{account.bankName}</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, letterSpacing: 1 }}>
            {maskCardNumber(account.cardNumber)}
          </Text>
          {account.note ? <Text style={{ fontSize: 11, color: colors.muted }}>{account.note}</Text> : null}
        </View>
        <View style={{ gap: 6 }}>
          <TouchableOpacity onPress={onEdit} style={[S.iconBtn, { borderColor: colors.border }]}>
            <IconSymbol name="pencil" size={14} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={[S.iconBtn, { borderColor: colors.error + "33" }]}>
            <IconSymbol name="trash" size={14} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
      {/* 一键复制区域 */}
      <View style={[S.copyRow, { borderTopColor: colors.border }]}>
        {showCopyAmount ? (
          <View style={{ flexDirection: "row", gap: 8, flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>¥</Text>
            <TextInput value={copyAmount} onChangeText={setCopyAmount}
              placeholder="输入金额" keyboardType="decimal-pad"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, fontSize: 14, color: colors.foreground, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 }} />
            <TouchableOpacity onPress={() => {
              onCopy(Number(copyAmount) || 0);
              setShowCopyAmount(false);
              setCopyAmount("");
            }} style={[S.copyBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>复制</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCopyAmount(false)}>
              <Text style={{ fontSize: 12, color: colors.muted }}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity onPress={() => onCopy()} style={[S.copyBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
              <IconSymbol name="doc.on.clipboard" size={13} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted }}>复制账户信息</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCopyAmount(true)}
              style={[S.copyBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="doc.on.clipboard" size={13} color="#fff" />
              <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>含金额复制</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SuppliersScreen() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { suppliers, addSupplier, updateSupplier, deleteSupplier } = useMonthlySummaryStore();

  const [filterCat, setFilterCat] = useState<SupplierCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBank, setEditingBank] = useState<SupplierBankAccount | null>(null);
  const [copyToast, setCopyToast] = useState("");

  const filtered = useMemo(() =>
    filterCat === "all" ? suppliers : suppliers.filter((s) => s.category === filterCat),
    [suppliers, filterCat]
  );
  const selected = selectedId ? suppliers.find((s) => s.id === selectedId) : null;

  const handleCopy = (text: string) => {
    Clipboard.setString(text);
    setCopyToast("已复制到剪贴板");
    setTimeout(() => setCopyToast(""), 2000);
  };

  const handleSaveBankAccount = (data: Omit<SupplierBankAccount, "id">) => {
    if (!selectedId) return;
    const sup = suppliers.find((s) => s.id === selectedId);
    if (!sup) return;
    if (editingBank) {
      const updated = sup.bankAccounts.map((a) => a.id === editingBank.id ? { ...a, ...data } : a);
      updateSupplier(selectedId, { bankAccounts: updated });
    } else {
      const newAcc: SupplierBankAccount = { ...data, id: uuid() };
      updateSupplier(selectedId, { bankAccounts: [...(sup.bankAccounts ?? []), newAcc] });
    }
  };

  const handleDeleteBank = (accId: string) => {
    if (!selectedId) return;
    const sup = suppliers.find((s) => s.id === selectedId);
    if (!sup) return;
    updateSupplier(selectedId, { bankAccounts: sup.bankAccounts.filter((a) => a.id !== accId) });
  };

  if (selected) {
    return (
      <ScreenContainer>
        <View style={[S.navbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setSelectedId(null)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 4 })}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={{ fontSize: 16, color: colors.primary }}>供应商</Text>
          </Pressable>
          <Text style={[S.navTitle, { color: colors.foreground }]}>{selected.name}</Text>
          <View style={{ width: 60 }} />
        </View>
        <SupplierDetail
          supplier={selected} colors={colors}
          onEdit={() => { setEditingSupplier(selected); setShowForm(true); }}
          onBack={() => setSelectedId(null)}
          onAddBank={() => { setEditingBank(null); setShowBankForm(true); }}
          onEditBank={(acc) => { setEditingBank(acc); setShowBankForm(true); }}
          onDeleteBank={handleDeleteBank}
          onCopy={handleCopy}
        />
        {copyToast ? (
          <View style={[S.toast, { backgroundColor: colors.foreground }]}>
            <Text style={{ color: colors.background, fontSize: 13 }}>{copyToast}</Text>
          </View>
        ) : null}
        <BankAccountModal
          visible={showBankForm} account={editingBank} colors={colors}
          onSave={handleSaveBankAccount}
          onClose={() => { setShowBankForm(false); setEditingBank(null); }}
        />
        <SupplierFormModal
          visible={showForm} supplier={editingSupplier} colors={colors}
          onSave={(data) => {
            if (editingSupplier) {
              updateSupplier(editingSupplier.id, data);
            }
          }}
          onClose={() => { setShowForm(false); setEditingSupplier(null); }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>供应商档案</Text>
        <Pressable onPress={() => { tap(); setEditingSupplier(null); setShowForm(true); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* 品类筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {(["all", ...CATEGORY_OPTIONS] as (SupplierCategory | "all")[]).map((c) => {
          const sel = filterCat === c;
          const color = c === "all" ? colors.primary : SUPPLIER_CATEGORY_COLORS[c];
          return (
            <TouchableOpacity key={c} onPress={() => { tap(); setFilterCat(c); }}
              style={[S.filterChip, { backgroundColor: sel ? color : colors.surface, borderColor: sel ? color : colors.border }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: sel ? "#fff" : color }}>
                {c === "all" ? "全部" : SUPPLIER_CATEGORY_LABELS[c]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {filtered.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 36 }}>🏪</Text>
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>暂无供应商档案</Text>
            <TouchableOpacity onPress={() => { setEditingSupplier(null); setShowForm(true); }}
              style={{ backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 16 }}>
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>新增供应商</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((sup) => {
            const catColor = SUPPLIER_CATEGORY_COLORS[sup.category];
            return (
              <TouchableOpacity key={sup.id} onPress={() => { tap(); setSelectedId(sup.id); }}
                style={[S.supplierRow, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: catColor, borderLeftWidth: 3 }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup.name}</Text>
                    {sup.nameEn ? <Text style={{ fontSize: 12, color: colors.muted }}>{sup.nameEn}</Text> : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    <View style={[S.catTag, { backgroundColor: catColor + "15", borderColor: catColor + "33" }]}>
                      <Text style={{ fontSize: 10, color: catColor, fontWeight: "600" }}>{SUPPLIER_CATEGORY_LABELS[sup.category]}</Text>
                    </View>
                    {sup.paymentTerms ? (
                      <View style={[S.catTag, { backgroundColor: colors.border + "33", borderColor: colors.border }]}>
                        <Text style={{ fontSize: 10, color: colors.muted }}>{sup.paymentTerms}</Text>
                      </View>
                    ) : null}
                    <Text style={{ fontSize: 11, color: colors.muted }}>{sup.bankAccounts.length} 个账户</Text>
                  </View>
                </View>
                <IconSymbol name="chevron.right" size={14} color={colors.muted} />
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {copyToast ? (
        <View style={[S.toast, { backgroundColor: colors.foreground }]}>
          <Text style={{ color: colors.background, fontSize: 13 }}>{copyToast}</Text>
        </View>
      ) : null}

      <SupplierFormModal
        visible={showForm} supplier={editingSupplier} colors={colors}
        onSave={(data) => {
          if (editingSupplier) {
            updateSupplier(editingSupplier.id, data);
          } else {
            const id = addSupplier(data);
            setSelectedId(id);
          }
        }}
        onClose={() => { setShowForm(false); setEditingSupplier(null); }}
      />
    </ScreenContainer>
  );
}

// ─── 小组件 ───────────────────────────────────────────────────────────────────
function SectionCard({ title, colors, children }: { title: string; colors: any; children: React.ReactNode }) {
  return (
    <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[S.sectionTitle, { color: colors.muted }]}>{title}</Text>
      {children}
    </View>
  );
}
function FormRow({ label, required, colors, children }: { label: string; required?: boolean; colors: any; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
        {label}{required ? " *" : ""}
      </Text>
      {children}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  catTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  emptyBank: { borderRadius: 10, borderWidth: 1, borderStyle: "dashed", padding: 20, alignItems: "center" },
  bankCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  defaultTag: { position: "absolute", top: 8, right: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  bankIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  copyRow: { flexDirection: "row", gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  supplierRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  toast: { position: "absolute", bottom: 40, alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
});

const FM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
