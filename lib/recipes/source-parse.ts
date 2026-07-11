/**
 * 引用来源结构化解析:从自由文本 source 字段中解析出
 * 酒吧/书名、调酒师(创作者)、季节、年份,缺失字段返回 null 不展示。
 *
 * 支持的常见写法:
 * - "The Waldorf Astoria Bar Book (Frank Caiafa)"           → 书名 + 创作者
 * - "Death & Co, New York (Phil Ward, 2007)"                → 酒吧 + 创作者 + 年份
 * - "创作者:Sam Ross, Milk & Honey, 2005"                   → 创作者 + 酒吧 + 年份
 * - "Attaboy · Winter 2018"                                  → 酒吧 + 季节 + 年份
 */
export interface ParsedSource {
  /** 酒吧或书名 */
  venue: string | null;
  /** 调酒师/创作者 */
  creator: string | null;
  /** 季节(春/夏/秋/冬/Spring/Summer/Fall/Autumn/Winter) */
  season: string | null;
  /** 年份(1800-2099) */
  year: string | null;
  /** 无法解析出结构时的原始文本 */
  raw: string;
}

const SEASON_RE = /(春季?|夏季?|秋季?|冬季?|spring|summer|fall|autumn|winter)/i;
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;
/** 人名启发:2-4 个首字母大写单词(允许 & / and 连接两人) */
const PERSON_RE =
  /^(?:[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){1,3})(?:\s*(?:&|and|\/)\s*[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){1,3})?$/;
const CREATOR_LABEL_RE = /(?:创作者|调酒师|creator|bartender|by)[::\s]+([^,;·|()]+)/i;

export function parseSource(source: string): ParsedSource {
  const raw = source.trim();
  const out: ParsedSource = { venue: null, creator: null, season: null, year: null, raw };
  if (!raw) return out;

  let rest = raw;

  // 年份与季节(全局提取)
  const y = rest.match(YEAR_RE);
  if (y) out.year = y[1];
  const s = rest.match(SEASON_RE);
  if (s) out.season = s[1];

  // 显式"创作者:"标注
  const cl = rest.match(CREATOR_LABEL_RE);
  if (cl) {
    out.creator = cl[1].trim();
    rest = rest.replace(cl[0], "").trim();
  }

  // 括号内容:多为创作者(可含年份)
  const paren = rest.match(/[((]([^))]+)[))]/);
  if (paren) {
    const inner = paren[1]
      .replace(YEAR_RE, "")
      .replace(SEASON_RE, "")
      .replace(/[,,]\s*$/, "")
      .trim();
    if (inner && !out.creator && PERSON_RE.test(inner)) out.creator = inner;
    else if (inner && !out.creator && /^[\u4e00-\u9fa5·]{2,8}$/.test(inner)) out.creator = inner;
    rest = rest.replace(paren[0], "").trim();
  }

  // 剩余部分按分隔符拆段:识别 酒吧/书名 与 人名
  const segs = rest
    .split(/[,,;;·|]/)
    .map((x) => x.replace(YEAR_RE, "").replace(SEASON_RE, "").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim())
    .filter(Boolean);
  for (const seg of segs) {
    if (!out.creator && PERSON_RE.test(seg) && !/\b(bar|book|hotel|club|house|room|tavern|saloon)\b/i.test(seg)) {
      out.creator = seg;
    } else if (!out.venue) {
      out.venue = seg;
    } else {
      // 追加到 venue(如 "Death & Co, New York" 的城市部分)
      out.venue = `${out.venue}, ${seg}`;
    }
  }
  return out;
}
