#!/usr/bin/env node
/**
 * 雄狮方案工厂 - 事件驱动 Daemon v2
 * 
 * 核心改动：不再间接通过 openclaw cron run 触发 worker
 * 而是 daemon 自身：检测 pending → claim → 构建 task → spawn 大橘（openclaw agent）
 * 
 * 大橘 session 有完整 LLM 能力：读文件/exec/HTTP/message
 * plan_finalize.js 里的大象卡片通知能正常发出
 * 
 * 启动：node agents/plan_daemon.js &
 * 停止：kill $(cat /tmp/plan_daemon.pid)
 */

import { writeFileSync, unlinkSync, readFileSync, existsSync, appendFileSync, statSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PID_FILE = '/tmp/plan_daemon.pid';
const HEARTBEAT_FILE = '/tmp/plan_daemon_heartbeat';
const LOG_FILE = '/tmp/plan_daemon.log';
const SUPABASE_URL = 'https://dbcli-fa5jbg9a51h059rr.database.sankuai.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzQ2OTc5MjAwLCJleHAiOjE5MDQ3NDU2MDB9.P3fFwg7kzoH-CAIRee90cjq26uHvqb6PFc9y6FUC5wo';

// MIS → UID 映射
let MIS_UID_MAP = {};
try {
  MIS_UID_MAP = JSON.parse(readFileSync(path.join(__dirname, 'mis_uid_map.json'), 'utf8'));
} catch { /* 文件不存在时为空 */ }

const IDLE_INTERVAL = 30_000;   // 空闲时 30s
const BUSY_INTERVAL = 5_000;    // 密集模式 5s
const BUSY_DURATION = 120_000;  // 密集模式持续 2 分钟（大橘需要时间跑）
const MAX_CONCURRENT = 3;       // 最大并发大橘数
const RETRY_FILE = path.join(__dirname, '.plan_retry_counts.json');
const MAX_RETRIES = 3;

let currentInterval = IDLE_INTERVAL;
let busyUntil = 0;
let timer = null;
let processingIds = new Set(); // 正在跑的 plan IDs（避免重复 spawn）

// ── 防重复启动：检查 PID file ──────────────────────────────────────────
if (existsSync(PID_FILE)) {
  const existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!isNaN(existingPid)) {
    try {
      // kill -0 检查进程是否存在（不发真实信号）
      process.kill(existingPid, 0);
      // 进程存在，直接退出
      console.error(`[plan_daemon] ⚠️  另一个实例正在运行 (PID: ${existingPid})，退出。`);
      console.error(`[plan_daemon]    如需强制重启，先运行: kill ${existingPid}`);
      process.exit(1);
    } catch {
      // 进程不存在（ESRCH），PID file 是僵尸文件，继续启动
      console.log(`[plan_daemon] 旧 PID ${existingPid} 已不存在，清理后继续启动`);
    }
  }
}

// 写 PID 文件
writeFileSync(PID_FILE, String(process.pid));
log(`🚀 Plan Daemon v2 started (PID: ${process.pid})`);

// Graceful shutdown
function cleanup() {
  log('🛑 Shutting down...');
  if (timer) clearTimeout(timer);
  try { unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGHUP', cleanup);

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  const line = `[${ts}] ${msg}\n`;
  // stdout 是 tty（终端直接运行）才写 stdout；nohup 重定向时 isTTY=false，只写文件避免双写
  if (process.stdout.isTTY) {
    process.stdout.write(line);
  }
  try {
    // 日志超200KB时截断（降低阈值，减少磁盘占用）
    try { if (statSync(LOG_FILE).size > 200_000) writeFileSync(LOG_FILE, `[截断] 超过200KB，已清空\n`); } catch {}
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// 重试计数管理
function loadRetryCounts() {
  try { return JSON.parse(readFileSync(RETRY_FILE, 'utf8')); } catch { return {}; }
}
function saveRetryCounts(counts) {
  writeFileSync(RETRY_FILE, JSON.stringify(counts, null, 2));
}
function getRetryCount(planId) {
  return loadRetryCounts()[planId] || 0;
}
function incrementRetry(planId) {
  const counts = loadRetryCounts();
  counts[planId] = (counts[planId] || 0) + 1;
  saveRetryCounts(counts);
  return counts[planId];
}
function clearRetry(planId) {
  const counts = loadRetryCounts();
  delete counts[planId];
  saveRetryCounts(counts);
}

// ── Supabase API ──────────────────────────────────────────────────────

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

async function supabasePatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}`);
  return res.json();
}

// CAS claim：只有 pending 才能改为 generating
async function claimPlan(id) {
  const rows = await supabasePatch(
    `plans?id=eq.${id}&status=eq.pending`,
    { status: 'generating', updated_at: new Date().toISOString() }
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── 构建大橘任务（从 plan_queue_worker.mjs 移植） ──────────────────────

function buildDajuTask(plan) {
  const fmt = plan.output_format || 'html';
  const outputExt = fmt === 'word' ? 'docx' : fmt === 'pptx' ? 'pptx' : 'html';
  const outputPath = `/tmp/plan_output_${plan.id}.${outputExt}`;
  const planId = plan.id;

  const isRevision = !!(plan.revision_notes || (plan.revision_images && plan.revision_images.length > 0));
  const revisionImages = Array.isArray(plan.revision_images) ? plan.revision_images : [];

  const modeHeader = isRevision
    ? `【自动化生成模式·修改模式·第一步：主方案】你是大橘🍊，现在处理方案工厂队列任务。

⚠️ 这是【方案修改任务】，BD对上一版本提出了修改意见：

## 修改说明
${plan.revision_notes || '（无文字备注）'}

${revisionImages.length > 0 ? `## 参考图片（共 ${revisionImages.length} 张）\n${revisionImages.map((url, i) => `图${i + 1}：${url}`).join('\n')}` : ''}

---`
    : `【自动化生成模式·第一步：主方案】你是大橘🍊，现在处理方案工厂队列任务。`;

  return `${modeHeader}

⚠️ 严禁：装修改造/搭舞台/请歌手/搞灯光工程等需要大额投入的建议
⚠️ 这是自动化流程：信息不足时做合理假设并在方案中标注，不要等待确认
⚠️ 方案视角是「门店怎么赢」不是「SaaS有什么功能」
⚠️ 必须包含公私域联动：公域（大众点评+适合品类的小红书/抖音）+ 私域（会员/储值）
⚠️ 竞品分析要写周边真实竞对（名称/人均/弱点），不是"美团收银vs传统收银"
⚠️ 必须有量化OKR目标（月营收/评分/会员数）

## 门店信息
- 店名：${plan.shop_name}
- 品类：${plan.category}
- 省市区：${[plan.province, plan.city, plan.district].filter(Boolean).join('')}
- 详细地址：${plan.address || '未提供'}
- 人均客单价：${plan.avg_price ? `¥${plan.avg_price}` : '未知'}
- 大众点评评分：${plan.rating || '未知'}（评价数：${plan.review_count || '未知'}）
- 月流水：${plan.monthly_revenue ? `¥${plan.monthly_revenue}` : '未知'}
- 门店面积：${plan.area_sqm ? `${plan.area_sqm}㎡` : '未知'}
- 已签约SaaS产品：${plan.products || '待确认，假设基础版会员+扫码点餐'}
- 竞品情况：${plan.competitors || '未提供'}
- 备注/特殊需求：${plan.notes || '无'}
${plan.profit_calc_image ? `- 盈利测算截图：${plan.profit_calc_image}（老板已完成测算，方案中必须有对应的投资回报分析章节，使用截图中的数字）` : ''}
${(() => {
  if (!plan.profit_calc_data) return '';
  try {
    const p = typeof plan.profit_calc_data === 'string' ? JSON.parse(plan.profit_calc_data) : plan.profit_calc_data;
    const pd = p.proposalData || {};
    const lines = [
      '',
      '## 🔢 盈利测算数据（由门店老板填写，数据可信度高，必须优先使用）',
      `- 月总营收：¥${Math.round(p.totalRevenue).toLocaleString()}`,
      `- 月净利润：¥${Math.round(p.monthProfit).toLocaleString()}（利润率 ${p.profitRate}%）`,
      `- 房租占比：${p.rentRatio}%  人工占比：${p.laborRatio}%  食材成本率：${p.foodCostRatio}%`,
      `- 盈亏平衡翻台率：${pd.breakEvenTurnover || '未知'} 次/天`,
    ];
    if (pd.storageTiers && pd.storageTiers.length) {
      lines.push(`- 储值档位（系统推算）：${pd.storageTiers.map(t => `${t.name} ¥${t.amount}元（赠${t.bonus}元）`).join(' / ')}`);
      lines.push(`- 月储值目标：¥${Math.round(pd.monthlyStorageTarget).toLocaleString()}`);
    }
    if (pd.diagnosisTags && pd.diagnosisTags.length) {
      lines.push(`- 诊断标签：${pd.diagnosisTags.join(' · ')}`);
    }
    lines.push('');
    lines.push('⚠️ 储值方案章节必须使用以上档位数字，不得改动；ROI/投资回报章节必须基于以上月营收/利润率数据计算，不得使用行业假设值。');
    return lines.join('\n');
  } catch { return ''; }
})()}

## 执行步骤

### 第一阶段：生成完整主方案
1. 读取 /root/.openclaw/workspace/agents/fafa2.md（你的核心配置）
2. 按照铁律0-5条执行（第0条：自动搜大众点评数据）
3. 选择对应品类知识文件（只读对应品类章节）
${outputExt === 'html' ? `4. 生成完整运营方案内容，输出为 JSON 文件，保存到 /tmp/plan_content_${planId}.json
   - JSON 格式：参考 /root/.openclaw/workspace/agents/fafa2_web_version.md「JSON输出规范」章节
   - ⚠️ 章节数量根据门店实际情况灵活决定（通常6-10章），禁止固定8章，禁止照抄章节名称模版
   - 有什么痛点写什么章节：评分低→点评专项，储值弱→储值专项，外卖少→外卖专项
   - 有盈利测算数据时，投资回报章节必须存在并使用测算数字
   - locked 分配：前半 locked:false，后半 locked:true
   - 每章 content 字段必须有实质内容（≥300字），支持 HTML 标签
   - 有真实门店数据时优先用真实数据；数据不足时用行业参考值并标注「（行业参考值）」
4.5 JSON 写完后，执行 HTML 组装：
   node /root/.openclaw/workspace/agents/plan_assemble_html.js ${planId} /tmp/plan_content_${planId}.json ${outputPath}
   等待输出 ASSEMBLE_OK 后继续` : `4. 生成完整运营方案（格式：${outputExt === 'pptx' ? 'PPT' : 'Word'}），保存到 ${outputPath}
   - 内容框架必须完整：现状诊断/竞品分析/核心策略/会员体系/公私域联动/营销节奏/OKR/ROI
   - 每个模块内容充实，页数/章节不设上限`}
5. **输出文件前必做质检**（读 fafa2_ppt_standard.md 第九章 Checklist）：
   - 数字自洽：月流水÷客单=人次；ROI月增收 和 OKR月目标数字完全一致
   - 竞品是周边真实门店（名称/人均/弱点），非"传统收银vs美团"
   - 公私域联动是闭环流程，非三平台各自列清单
   - 🔴 不通过必须返工
5.5 生成方案摘要（100字以内）并写入文件：
   - 格式：「[品类/客单定位]。方案核心是[核心策略]。目标：[最关键OKR]。」
   - 必须执行以下命令把摘要写入文件（供 plan_finalize.js 读取用于大象通知）：
     node -e "require('fs').writeFileSync('/tmp/plan_summary_${planId}.txt', '摘要内容放这里')"
   - 将摘要正文替换上面命令中的"摘要内容放这里"，整条命令执行完成
   - 以单独一行输出：SUMMARY:[摘要内容]
6. 确认文件存在后输出：MAIN_PLAN_DONE:${outputPath}

### 第二阶段：收割（上传+通知）
7. 执行：node /root/.openclaw/workspace/agents/plan_finalize.js ${planId} ${outputPath}
8. 最后一行输出：FILE_READY:${outputPath}

## 重要
- 完成后只输出最后一行 FILE_READY:路径
`;
}

// ── SSO Token 获取（复用 finalize 同款逻辑） ─────────────────────────

const DX_TOKEN_ENDPOINT = 'https://ssosv.sankuai.com/sson/auth/oidc/v1/token';
const DX_TEXT_ENDPOINT  = 'https://xopen.sankuai.com/open-apis/dx-msg/sendChatMsgByRobot';
const DX_MIS_AUDIENCE   = 'xm-xai';
const DX_CLIENT_SECRET  = '4294bffbd10b41c3a1057501794077e4';
const _tokenCache = {};

async function getDxToken(audience = DX_MIS_AUDIENCE) {
  const now = Date.now();
  if (_tokenCache[audience]?.expireAt > now + 60000) return _tokenCache[audience].token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: DX_CLIENT_ID,
    client_secret: DX_CLIENT_SECRET,
    scope: `client_id:${audience}`,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  });
  const resp = await fetch(DX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token失败: ${JSON.stringify(data)}`);
  _tokenCache[audience] = { token: data.access_token, expireAt: now + (data.expires_in || 10800) * 1000 };
  return data.access_token;
}

// ── 提交确认通知 ──────────────────────────────────────────────────────

async function sendSubmitConfirm(plan) {
  if (!plan.mis) return;
  // 先查静态映射表，没有就调 xopen 查
  let empId = MIS_UID_MAP[plan.mis] || null;
  if (!empId) {
    log(`[${plan.id}] 提交通知：mis(${plan.mis})不在映射表，尝试动态查询`);
    try {
      const token = await getDxToken();
      const r = await fetch('https://xopen.sankuai.com/open-apis/dx/queryEmpIdentityByMisList', {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ misList: [plan.mis] }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      empId = d?.data?.data?.[plan.mis]?.empId ? String(d.data.data[plan.mis].empId) : null;
    } catch (e) {
      log(`[${plan.id}] 提交通知：动态查询UID失败: ${e.message}`);
    }
  }
  if (!empId) {
    log(`[${plan.id}] 提交通知：无法解析 mis(${plan.mis}) 对应 UID，跳过`);
    return;
  }

  const msg = `✅ 【雄狮方案工厂】\n「${plan.shop_name}」的运营方案已收到，正在生成中，预计需要 5~15 分钟，完成后会自动发给你 🍊`;
  try {
    const token = await getDxToken();
    const payload = {
      receiverIds: [Number(empId)],
      sendMsgInfo: { type: 'text', body: JSON.stringify({ text: msg }) },
    };
    const res = await fetch(DX_TEXT_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.status?.code === 0) {
      log(`[${plan.id}] ✅ 提交确认通知已发 → ${plan.mis}(${empId})`);
    } else {
      log(`[${plan.id}] ⚠️ 提交确认通知发送失败: ${JSON.stringify(data?.status || data).slice(0, 100)}`);
    }
  } catch (e) {
    log(`[${plan.id}] 提交确认通知异常: ${e.message}`);
  }
}

// ── Spawn 大橘 ──────────────────────────────────────────────────────

function spawnDaju(plan) {
  const planId = plan.id;
  const task = buildDajuTask(plan);
  const uid = MIS_UID_MAP[plan.mis] || null;

  log(`[${planId}] 🍊 Spawning 大橘 for: ${plan.shop_name}`);

  // 写 task 到临时文件（避免参数太长）
  const taskFile = `/tmp/daju_task_${planId}.txt`;
  writeFileSync(taskFile, task);

  // 通过 openclaw agent 启动一个完整的 LLM session
  // 每个 plan 用唯一 session-id，避免跟其他session冲突
  const sessionId = `plan-factory-${planId}-${Date.now()}`;
  const child = spawn('openclaw', [
    'agent',
    '--session-id', sessionId,
    '--message', task,
    '--timeout', '1800',
    '--thinking', 'low'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env },
  });

  child.unref();

  // 记录日志（非阻塞）
  let output = '';
  child.stdout?.on('data', (d) => { output += d.toString().slice(-2000); });
  child.stderr?.on('data', (d) => { output += d.toString().slice(-500); });

  child.on('exit', (code) => {
    processingIds.delete(planId);
    if (code === 0) {
      log(`[${planId}] ✅ 大橘完成 (exit 0)`);
      clearRetry(planId);
      // 触发 finalize notify-only：大橘完成后补发通知（兜底，防止大橘自己没调）
      // 延迟30秒等大橘的 finalize 先跑完（避免重复通知）
      setTimeout(() => {
        log(`[${planId}] 🔔 daemon 兜底：触发 finalize --notify-only`);
        const finalizeChild = spawn('node', [
          path.join(__dirname, 'plan_finalize.js'),
          String(planId),
          '--notify-only'
        ], { stdio: 'inherit' });
        finalizeChild.on('exit', (fc) => {
          log(`[${planId}] finalize notify exit ${fc}`);
        });
        finalizeChild.on('error', (e) => {
          log(`[${planId}] finalize notify error: ${e.message}`);
        });
      }, 30000);
    } else {
      log(`[${planId}] ❌ 大橘失败 (exit ${code}): ${output.slice(-200)}`);
      // 重试逻辑
      const retries = incrementRetry(planId);
      if (retries >= MAX_RETRIES) {
        log(`[${planId}] 🔴 超过${MAX_RETRIES}次重试，标为error`);
        supabasePatch(`plans?id=eq.${planId}`, { status: 'error', updated_at: new Date().toISOString() }).catch(() => {});
      } else {
        log(`[${planId}] 🔄 回滚pending，第${retries}次重试`);
        supabasePatch(`plans?id=eq.${planId}`, { status: 'pending', updated_at: new Date().toISOString() }).catch(() => {});
      }
    }
  });

  child.on('error', (err) => {
    processingIds.delete(planId);
    log(`[${planId}] ❌ spawn error: ${err.message}`);
    supabasePatch(`plans?id=eq.${planId}`, { status: 'pending', updated_at: new Date().toISOString() }).catch(() => {});
  });
}

// ── 主逻辑 ────────────────────────────────────────────────────────────

async function checkAndProcess() {
  try {
    const plans = await supabaseGet(
      `plans?status=eq.pending&order=created_at.asc&limit=${MAX_CONCURRENT}&select=id,shop_name,category,province,city,district,address,avg_price,rating,review_count,monthly_revenue,area_sqm,products,competitors,notes,output_format,mis,revision_notes,revision_images,profit_calc_data,profit_calc_image`
    );

    // 更新心跳
    writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      pid: process.pid,
      lastCheck: new Date().toISOString(),
      pendingCount: plans?.length || 0,
      processingIds: [...processingIds],
      mode: Date.now() < busyUntil ? 'busy' : 'idle',
    }));

    if (!plans || plans.length === 0) {
      if (Date.now() >= busyUntil && currentInterval !== IDLE_INTERVAL) {
        currentInterval = IDLE_INTERVAL;
        log('😴 No pending plans, back to idle mode');
      }
      return;
    }

    // 过滤掉正在处理的
    const actionable = plans.filter(p => !processingIds.has(p.id));
    if (actionable.length === 0) {
      if (Date.now() < busyUntil) {
        log(`⏳ ${plans.length} pending plan(s), ${processingIds.size} already processing`);
      }
      return;
    }

    // 过滤掉超过重试限制的
    const eligible = actionable.filter(p => {
      const retries = getRetryCount(p.id);
      if (retries >= MAX_RETRIES) {
        log(`[${p.id}] 🔴 超过重试限制(${retries}次)，标为error`);
        supabasePatch(`plans?id=eq.${p.id}`, { status: 'error', updated_at: new Date().toISOString() }).catch(() => {});
        return false;
      }
      return true;
    });

    if (eligible.length === 0) return;

    log(`🔥 Processing ${eligible.length} plan(s): [${eligible.map(p => `${p.id}:${p.shop_name}`).join(', ')}]`);

    // 切换密集模式
    currentInterval = BUSY_INTERVAL;
    busyUntil = Date.now() + BUSY_DURATION;

    // Claim + Spawn
    for (const plan of eligible) {
      try {
        const claimed = await claimPlan(plan.id);
        if (!claimed) {
          log(`[${plan.id}] 已被其他实例认领，跳过`);
          continue;
        }
        processingIds.add(plan.id);
        // 发提交确认通知
        sendSubmitConfirm(plan).catch(e => log(`[${plan.id}] 提交通知失败: ${e.message}`));
        spawnDaju({ ...plan, ...claimed });
      } catch (err) {
        log(`[${plan.id}] claim失败: ${err.message}`);
      }
    }
  } catch (e) {
    log(`❌ Check error: ${e.message?.substring(0, 100)}`);
  }
}

// 检查 stuck plans（generating 超20分钟）
let lastStuckCheck = 0;
async function checkStuck() {
  const now = Date.now();
  if (now - lastStuckCheck < 5 * 60 * 1000) return;
  lastStuckCheck = now;

  try {
    const cutoff = new Date(now - 20 * 60 * 1000).toISOString();
    const stuck = await supabaseGet(`plans?status=eq.generating&updated_at=lt.${cutoff}&select=id,shop_name`);
    if (stuck?.length > 0) {
      log(`⚠️ ${stuck.length} stuck generating plan(s), resetting to pending`);
      for (const p of stuck) {
        const retries = incrementRetry(p.id);
        if (retries >= MAX_RETRIES) {
          await supabasePatch(`plans?id=eq.${p.id}`, { status: 'error', updated_at: new Date().toISOString() });
          log(`[${p.id}] 🔴 stuck + 超过重试 → error`);
        } else {
          await supabasePatch(`plans?id=eq.${p.id}`, { status: 'pending', updated_at: new Date().toISOString() });
          processingIds.delete(p.id);
          log(`[${p.id}] 🔄 stuck → pending (retry ${retries})`);
        }
      }
    }
  } catch {}
}

// ── 处理降级通知队列（pending_notifications.json） ──────────────────────
const PENDING_NOTIF_FILE = '/tmp/pending_notifications.json';
const DX_CLIENT_ID = 'aed2320a23';
const DX_CARD_TPL = '51642';
let lastNotifFlush = 0;

async function flushPendingNotifications() {
  const now = Date.now();
  // 每2分钟检查一次，不要每30秒都跑
  if (now - lastNotifFlush < 2 * 60 * 1000) return;
  lastNotifFlush = now;

  if (!existsSync(PENDING_NOTIF_FILE)) return;

  let pending;
  try {
    pending = JSON.parse(readFileSync(PENDING_NOTIF_FILE, 'utf8'));
  } catch { return; }

  if (!Array.isArray(pending) || pending.length === 0) return;

  log(`📬 flush pending notifications: ${pending.length} 条`);

  const remaining = [];
  for (const item of pending) {
    const { target, message, label, planId } = item;
    if (!target || !message) continue;

    try {
      // 尝试通过大象开放平台发文字消息（empId）
      const body = {
        client_id: DX_CLIENT_ID,
        to_employee_id: [String(target)],
        body: { content: message },
        msg_type: 'text',
      };
      const res = await fetch('https://daxiang.sankuai.com/api/message/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data?.code === 0 || data?.status?.code === 0)) {
        log(`📬 [${label || target}] 降级文字通知发送成功 → empId ${target}`);
        // 写回 notified_at（如果有 planId）
        if (planId) {
          supabasePatch(`plans?id=eq.${planId}`, { notified_at: new Date().toISOString() }).catch(() => {});
        }
      } else {
        log(`📬 [${label || target}] 文字通知发送失败: ${JSON.stringify(data).slice(0, 100)}，保留重试`);
        remaining.push(item);
      }
    } catch (e) {
      log(`📬 [${label || target}] 文字通知异常: ${e.message}，保留重试`);
      remaining.push(item);
    }
  }

  // 写回剩余（失败的）
  try {
    if (remaining.length === 0) {
      writeFileSync(PENDING_NOTIF_FILE, '[]');
    } else {
      writeFileSync(PENDING_NOTIF_FILE, JSON.stringify(remaining, null, 2));
    }
  } catch {}
}

// 主循环
async function loop() {
  await checkAndProcess();
  await checkStuck();
  await flushPendingNotifications();
  timer = setTimeout(loop, currentInterval);
}

loop();
