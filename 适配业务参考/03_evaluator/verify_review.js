const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "eval_results", "review_report.html"), "utf8");

// 提取所有非 JSON 的 <script> 块
const blocks = [];
const re = /<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
console.log("JS 块数量:", blocks.length);

const dataMatch = /<script id="DATA" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
const cases = JSON.parse(dataMatch[1]);
console.log("用例数:", cases.length);

// ---------- 最小 DOM stub ----------
const nodes = {};
function mkEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [], dataset: {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); }
    },
    _html: "", _text: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    scrollIntoView() {}, click() {}, get previousElementSibling() { return null; },
    style: {}, title: "", value: "", checked: false,
  };
  return el;
}
global.document = {
  getElementById(id) { if (!nodes[id]) nodes[id] = mkEl("div"); return nodes[id]; },
  createElement(t) { return mkEl(t); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  addEventListener() {},
};
global.window = global;
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
};
global.Blob = class { constructor(a) { this.parts = a; } };
global.URL = { createObjectURL: () => "blob:x" };
global.Date = Date;

// ---------- 执行 ----------
const js = blocks.join("\n");
// 预置 DATA 节点，供 getElementById("DATA").textContent 读取
document.getElementById("DATA").textContent = dataMatch[1];
try {
  // 暴露内部函数以便断言
  const wrapped = js + "\n;globalThis.__T = { CASES, filtered, renderDiff, renderTurn, renderDetail, renderPairSection, toggleSync, setTurnVote, getTurnVote, setTurnNote, voteStats, agreeWithAI, judgeVerdictStats, humanCaseVerdict, buildExportPayload, hydrateVotesFromCases, dimStat, S, esc, isWriteTool, SYNC: SYNC_STATE };";
  new Function(wrapped)();
  console.log("✅ JS 执行无异常");

  const T = globalThis.__T;
  console.log("✅ 数据加载:", T.CASES.length, "条");

  // 1) 列表筛选
  T.S.onlyFail = true;
  const fails = T.filtered();
  console.log("✅ 仅看未通过 ->", fails.length, "条（期望 42）");
  T.S.onlyFail = false;
  const all = T.filtered();
  console.log("✅ 全部 ->", all.length, "条（期望 156）");

  // 2) 维度筛选
  T.S.dim = "dim_6_2";
  const d62 = T.filtered();
  console.log("✅ 维度 dim_6_2 ->", d62.length, "条（期望 20）");
  T.S.dim = null;

  // 3) diff 渲染
  const c = T.CASES.find(x => x.id === "intent_0001");
  const h1 = T.renderDiff(c.turns[0].workspace);
  console.log("✅ diff 渲染长度:", h1.length);
  console.log("  含新增行高亮:", h1.includes('class="ln add"'));
  console.log("  含删除行高亮:", h1.includes('class="ln del"'));
  console.log("  含未改动折叠:", h1.includes("未改动") || h1.includes("此处"));

  // 4) 单轮卡片渲染（检查 5 个区块都在）
  const h2 = T.renderTurn(c.turns[0]);
  ["① 用户说了什么", "② Agent 回了什么", "③ 调用了哪些工具", "🎯 本轮评测预期", "④ 裁判怎么判的", "⑤ 工作区前后对比"]
    .forEach(sec => console.log("  区块", sec, "->", h2.includes(sec)));

  // 5) 详情渲染
  T.renderDetail(c);
  const detail = nodes["detail"].innerHTML;
  console.log("✅ 详情渲染长度:", detail.length, "| 含案例ID:", detail.includes("intent_0001"));

  // 6) 安全用例（safety_0001）应判 FAIL 且能渲染
  const s1 = T.CASES.find(x => x.id === "safety_0001");
  console.log("✅ safety_0001 状态:", s1.status, "| 轮次:", s1.turns.length);
  T.renderDetail(s1);
  console.log("  safety 详情渲染 OK:", nodes["detail"].innerHTML.includes("safety_0001"));

  // 7) 写工具识别
  console.log("✅ 写工具识别 emitSkillFile:", T.isWriteTool("emitSkillFile"), "| getEditingSkill:", T.isWriteTool("getEditingSkill"));

  // 8) XSS 转义
  console.log("✅ XSS 转义:", T.esc('<img src=x onerror=1>') === "&lt;img src=x onerror=1&gt;");
  // 9) 新增：SKILL / References 完整内容前后对照
  const t0 = Date.now();
  const pc = T.CASES.find(x => x.id === "intent_0001").turns[0].workspace;
  console.log("✅ skill_pairs 数量:", (pc.skill_pairs || []).length, "| ref_pairs:", (pc.ref_pairs || []).length);
  const sp = (pc.skill_pairs || [])[0];
  if (sp) {
    console.log("   path:", sp.path, "| status:", sp.status);
    console.log("   before 行/字:", sp.before_lines, "/", sp.before_chars);
    console.log("   after  行/字:", sp.after_lines, "/", sp.after_chars);
  }
  const secH = T.renderPairSection("SKILL 内容", pc.skill_pairs, "📄");
  console.log("✅ pair 区块渲染长度:", secH.length);
  console.log("  含 Before 栏:", secH.includes("BEFORE（变更前）"));
  console.log("  含 After 栏:", secH.includes("AFTER（变更后）"));
  console.log("  含行号:", secH.includes('class="no"'));
  console.log("  含字数delta:", secH.includes("字"));

  // 10) 顺序校验：元数据 → SKILL → References → diff
  const full = T.renderDiff(pc);
  const i1 = full.indexOf("meta-table");
  const i2 = full.indexOf("SKILL 内容");
  const i3 = full.indexOf("变更片段 diff");
  console.log("✅ 区块顺序 元数据<SKILL<diff :", i1 >= 0 && i1 < i2 && i2 < i3, `(${i1}, ${i2}, ${i3})`);

  // 11) references 用例
  const rc = T.CASES.find(x => x.turns.some(t => t.workspace && (t.workspace.ref_pairs || []).length));
  if (rc) {
    const rt = rc.turns.find(t => t.workspace && (t.workspace.ref_pairs || []).length);
    console.log("✅ references 样例:", rc.id, "T" + rt.turn, "| ref_pairs:", rt.workspace.ref_pairs.map(p => p.path + "[" + p.status + "]"));
    const rh = T.renderDiff(rt.workspace);
    console.log("  含 References 内容区:", rh.includes("References 内容"));
    console.log("  含 ref-banner:", rh.includes("ref-banner"));
  }

  // 12) 性能：详情渲染耗时
  const t1 = Date.now();
  T.renderDetail(T.CASES.find(x => x.id === "intent_0001"));
  console.log(`✅ 单 case 详情渲染耗时: ${t1 - t0}ms`);
  // 13) 同步/独立滚动开关（默认同步）
  const sp2 = T.renderPairSection("SKILL 内容", pc.skill_pairs, "📄");
  console.log("✅ 按钮渲染:", sp2.includes('class="sync-btn on"'));
  console.log("   默认文案为「🔗 同步」:", sp2.includes("🔗 同步"));
  console.log("   pair 容器默认 data-sync=1:", sp2.includes('data-sync="1"'));
  console.log("   pair 容器带唯一 id:", /id="pair_\d+"/.test(sp2));

  // 默认状态：渲染时即写入 true（同步）
  console.log("✅ 默认 SYNC_STATE 已置为同步:", T.SYNC["pair_1"] === true);

  // 模拟点击解绑
  const btn = {
    dataset: { pid: "pair_1" },
    classList: { _s: new Set(["on"]), toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    textContent: "🔗 同步", title: ""
  };
  T.toggleSync(btn);
  console.log("✅ 点击解绑 -> 文案:", btn.textContent, "| 状态:", T.SYNC["pair_1"], "| on 样式:", btn.classList.contains("on"));
  T.toggleSync(btn);
  console.log("✅ 再点恢复 -> 文案:", btn.textContent, "| 状态:", T.SYNC["pair_1"]);

  // 未改动文件不应有按钮
  const samePair = [{ path: "references/x.md", status: "same", before: "a", after: "a", before_lines: 1, after_lines: 1, before_chars: 1, after_chars: 1 }];
  const sameHtml = T.renderPairSection("References 内容", samePair, "📁");
  console.log("✅ 未改动文件无按钮:", !sameHtml.includes('class="sync-btn"'));

  // 14) 按轮次人工标记
  const c15 = T.CASES.find(x => x.id === "intent_0015");
  console.log("✅ 找到 intent_0015:", !!c15, "| 轮次:", c15 ? c15.turns.length : 0);
  console.log("   初始 getTurnVote:", T.getTurnVote("intent_0015", 1));

  T.setTurnVote("intent_0015", 1, "fail");
  T.setTurnVote("intent_0015", 2, "pass");
  console.log("✅ 标记后 T1:", JSON.stringify(T.getTurnVote("intent_0015", 1)));
  console.log("✅ 标记后 T2:", JSON.stringify(T.getTurnVote("intent_0015", 2)));

  const vs = T.voteStats();
  console.log("✅ voteStats:", JSON.stringify(vs));

  // 备注写入
  T.setTurnNote("intent_0015", 1, "该新建却没落地");
  console.log("✅ 备注写入:", T.getTurnVote("intent_0015", 1).note);

  // 再点一次 = 取消
  T.setTurnVote("intent_0015", 2, "pass");
  console.log("✅ 再点取消 T2:", T.getTurnVote("intent_0015", 2));

  // 一致性判断
  T.setTurnVote("intent_0015", 2, "pass");
  const agree = T.agreeWithAI(c15);
  console.log("✅ agreeWithAI -> 一致轮:", agree.agreed, "| 不一致轮:", agree.disagreed);

  // 渲染含标记的轮卡片
  const turnHtml = T.renderTurn(c15.turns[0], "intent_0015");
  console.log("✅ 轮卡片含标记按钮:", turnHtml.includes("tv-btn"));
  console.log("   含备注输入框:", turnHtml.includes("tv-note"));
  console.log("   已选状态 on(fail):", turnHtml.includes("tv-btn bad on"));

  // N/A 轮次不应有标记按钮
  const ctx = T.CASES.find(x => x.id === "context_0001");
  const naTurn = ctx.turns.find(t => t.scores.every(s => s.score !== 0 && s.score !== 1));
  if (naTurn) {
    const naHtml = T.renderTurn(naTurn, "context_0001");
    console.log("✅ N/A 轮无标记按钮:", !naHtml.includes("tv-btn"), "| 有 N/A 提示:", naHtml.includes("裁判无需判定"));
  }

  // 15) 导出 payload 结构
  const payload = T.buildExportPayload();
  console.log("✅ 导出 payload keys:", Object.keys(payload));
  console.log("   汇总:", JSON.stringify(payload.summary));
  console.log("   用例:", JSON.stringify(payload.cases["intent_0015"]));
  console.log("   轮次按数字排序:", Object.keys(payload.cases["intent_0015"].turns));

  // 17) 维度统计：维度名 / 下一行（裁判通过 X/N → 人工通过 Y/N）
  const dimKeys = ["dim_1_1", "dim_2_1", "dim_3_2", "dim_4_1", "dim_4_2", "dim_5_1", "dim_6_1", "dim_6_2"];
  console.log("✅ 维度「裁判通过 → 人工通过」统计：");
  dimKeys.forEach(k => {
    const s = T.dimStat(k);
    if (!s.total) return;
    const tail = [];
    if (s.naN) tail.push("N/A " + s.naN);
    if (s.unrevN) tail.push("未复核 " + s.unrevN);
    console.log(`   ${k.padEnd(9)} （裁判通过 ${s.aiPass}/${s.total} → 人工通过 ${s.humanPass}/${s.total}` +
      (tail.length ? "　" + tail.join(" · ") : "") + "）");
  });
  const a1 = T.humanCaseVerdict(T.CASES.find(x => x.id === "intent_0001"));
  console.log("✅ humanCaseVerdict(intent_0001):", JSON.stringify(a1));

} catch (e) {
  console.error("❌ 执行失败:", e.message);
  console.error(e.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}
