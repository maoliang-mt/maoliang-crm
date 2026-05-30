/**
 * 雄狮方案工厂 · 方案收割脚本 v2
 * 大橘生成文件后调用：
 *   node agents/plan_finalize.js <plan_id> <file_path>
 *
 * file_path 支持：
 *   - .pptx  → 直接上传为 plan_pptx_url，plan_file_url 同指向 PPTX
 *   - .html  → 转 DOCX（plan_file_url）+ 转 PPTX（plan_pptx_url）
 *   - .docx  → 直接上传为 plan_file_url
 *
 * 不支持 PDF 输出（2026-05-24 移除）
 *
 * plan_html_content：如果 file_path 是 .html，同时把内容写入 DB 字段
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

// PDF 转换已移除（2026-05-24），仅支持 PPTX/DOCX/HTML

const SUPABASE_URL = 'https://dbcli-fa5jbg9a51h059rr.database.sankuai.com';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzQ2OTc5MjAwLCJleHAiOjE5MDQ3NDU2MDB9.P3fFwg7kzoH-CAIRee90cjq26uHvqb6PFc9y6FUC5wo';

// ── 工具函数 ─────────────────────────────────────────────────────────

/**
 * 上传文件：优先走 GitHub Pages CDN，失败降级到 Supabase Storage
 */
async function uploadFile(localPath, fileName, planId = '') {
  // 1. 先尝试 GitHub Pages CDN（速度快，无跨域问题，iframe可直接嵌入）
  try {
    const cdnUrl = await uploadToCDN(localPath, planId || fileName.split('_')[1] || '');
    if (cdnUrl) {
      console.log(`[CDN] 上传成功: ${cdnUrl}`);
      return cdnUrl;
    }
  } catch (e) {
    console.log(`[CDN] 上传失败，降级到 Supabase: ${e.message}`);
  }

  // 2. 降级：Supabase Storage
  return await uploadToSupabase(localPath, fileName);
}

async function uploadToCDN(localPath, planId) {
  const { spawnSync: _spawn } = await import('child_process');
  const scriptPath = new URL('./upload_plan_cdn.js', import.meta.url).pathname;
  const r = _spawn('node', [scriptPath, localPath, planId], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env }
  });
  if (r.status !== 0) {
    throw new Error(r.stderr?.slice(0, 200) || 'CDN upload failed');
  }
  // 从 stdout 最后一行提取 CDN_URL:...
  const lines = (r.stdout || '').trim().split('\n');
  const urlLine = lines.reverse().find(l => l.startsWith('CDN_URL:'));
  if (!urlLine) throw new Error('CDN URL not found in output');
  return urlLine.replace('CDN_URL:', '').trim();
}

async function uploadToSupabase(localPath, fileName) {
  const fileBuffer = fs.readFileSync(localPath);
  const ext = fileName.split('.').pop().toLowerCase();
  const mimeTypes = {
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // pdf removed 2026-05-24
    html: 'text/html'
  };
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/plan-files/${fileName}`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: fileBuffer
  });
  if (!res.ok) throw new Error(`Supabase上传失败 ${res.status}: ${await res.text()}`);
  console.log(`[Supabase] 上传成功: ${fileName}`);
  return `${SUPABASE_URL}/storage/v1/object/public/plan-files/${fileName}`;
}

async function updatePlan(id, fields) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error(`updatePlan failed: ${res.status} ${await res.text()}`);
}

async function getPlan(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${id}&select=mis,shop_name,output_format,avg_price,monthly_revenue,area_sqm,category,notified_at,plan_abstract,summary,plan_share_url`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
  });
  const rows = res.ok ? await res.json() : [];
  return rows[0] || {};
}

/**
 * 基于门店数据估算盈利相关数据（用于方案工厂对接）
 * 仅使用 avg_price / monthly_revenue / area_sqm / category
 * 无精确成本数据时，用行业基准估算成本结构
 */
function estimateProfitData(plan) {
  const avgPrice = parseFloat(plan.avg_price) || 0;
  // monthly_revenue 单位：万元
  const monthlyRevenue = parseFloat(plan.monthly_revenue) || 0;
  const totalRevenue = monthlyRevenue * 10000; // 转换为元

  if (!avgPrice && !totalRevenue) return null;

  // 行业成本率基准（按品类）
  const category = (plan.category || '').toLowerCase();
  let foodCostRate = 0.35;
  let laborRate = 0.22;
  let rentRate = 0.12;
  if (category.includes('火锅') || category.includes('串串')) { foodCostRate = 0.40; laborRate = 0.23; }
  else if (category.includes('咖啡') || category.includes('茶饮') || category.includes('饮品')) { foodCostRate = 0.28; laborRate = 0.20; }
  else if (category.includes('快餐') || category.includes('小吃')) { foodCostRate = 0.38; laborRate = 0.18; rentRate = 0.10; }
  else if (category.includes('烧烤') || category.includes('夜宵')) { foodCostRate = 0.38; laborRate = 0.22; }

  // 估算利润率（简化版：营收 - 食材 - 人工 - 租金 - 水电其他）
  const otherRate = 0.10; // 水电+平台抽成+其他固定约10%
  const profitRate = 1 - foodCostRate - laborRate - rentRate - otherRate;
  const monthProfit = totalRevenue * profitRate;

  // 储值档位（基于客单价）
  const storageTiers = avgPrice > 0 ? [
    { name: '体验档', amount: Math.round(avgPrice * 2 / 10) * 10, gift: Math.round(avgPrice * 0.3) },
    { name: '主推档', amount: Math.round(avgPrice * 4.5 / 100) * 100, gift: Math.round(avgPrice * 1.2) },
    { name: '尊享档', amount: Math.round(avgPrice * 8 / 100) * 100, gift: Math.round(avgPrice * 3) },
  ] : [];

  // 月储值目标
  const monthlyStorageTarget = totalRevenue > 0 ? Math.round(totalRevenue * 0.15) : 0;

  // 诊断标签（简化版）
  const diagnosisTags = [];
  if (profitRate >= 0.2) diagnosisTags.push('盈利健康');
  else if (profitRate >= 0.1) diagnosisTags.push('盈利一般');
  else diagnosisTags.push('微利');
  diagnosisTags.push('租金估算');

  return {
    // 估算标识（前端可据此显示"数据不完整/仅供参考"）
    isEstimate: true,
    // 输入数据
    inputAvgPrice: avgPrice,
    inputMonthlyRevenue: monthlyRevenue,
    // 估算结果
    estimatedProfitRate: +(profitRate * 100).toFixed(1),
    estimatedMonthProfit: Math.round(monthProfit),
    // 方案对接数据
    storageTiers,
    monthlyStorageTarget,
    diagnosisTags,
  };
}

// ── HTML → PDF 已移除（2026-05-24）─────────────────────────────────

// ── HTML → PPTX（解析HTML章节，python-pptx重建）────────────────────

async function htmlToPptx(htmlPath, pptxPath, planId, shopName) {
  console.log(`[${planId}] HTML → PPTX 转换中...`);
  const script = `
import sys, re, os
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

html_path = sys.argv[1]
pptx_path = sys.argv[2]
shop_name = sys.argv[3] if len(sys.argv) > 3 else '方案'

with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# 解析 <section> 或按 <h2> 分割为页面内容块
sections = re.split(r'(?=<section|<div class="slide|<div class="page)', html)
if len(sections) < 3:
    # fallback：按 <h2> 分割
    parts = re.split(r'(<h2[^>]*>)', html)
    sections = []
    for i in range(1, len(parts), 2):
        if i+1 < len(parts):
            sections.append(parts[i] + parts[i+1])

def strip_tags(s):
    return re.sub(r'<[^>]+>', '', s).strip()

def extract_text_blocks(section_html):
    """从section html中提取标题和文本块列表"""
    # 标题
    h_match = re.search(r'<h[12][^>]*>(.*?)</h[12]>', section_html, re.DOTALL)
    title = strip_tags(h_match.group(1)) if h_match else ''
    # 副标题/描述
    sub_match = re.search(r'<h[34][^>]*>(.*?)</h[34]>', section_html, re.DOTALL)
    subtitle = strip_tags(sub_match.group(1)) if sub_match else ''
    # 列表项
    items = re.findall(r'<li[^>]*>(.*?)</li>', section_html, re.DOTALL)
    items = [strip_tags(i) for i in items if strip_tags(i)]
    # 段落文本
    paras = re.findall(r'<p[^>]*>(.*?)</p>', section_html, re.DOTALL)
    paras = [strip_tags(p) for p in paras if strip_tags(p) and len(strip_tags(p)) > 10]
    return title, subtitle, items, paras

# 创建PPT（16:9宽屏）
prs = Presentation()
prs.slide_width = Inches(13.33)
prs.slide_height = Inches(7.5)

DARK_BG = RGBColor(0x0a, 0x0e, 0x1a)
ACCENT = RGBColor(0x00, 0xd4, 0xff)
WHITE = RGBColor(0xff, 0xff, 0xff)
GRAY = RGBColor(0xcc, 0xcc, 0xcc)
ORANGE = RGBColor(0xff, 0x9a, 0x00)

blank_layout = prs.slide_layouts[6]  # blank

def add_slide(title_text, subtitle_text='', items=None, paras=None, is_cover=False):
    slide = prs.slides.add_slide(blank_layout)
    # 深色背景
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = DARK_BG

    # 顶部色条
    top_bar = slide.shapes.add_shape(1, 0, 0, prs.slide_width, Inches(0.08))
    top_bar.fill.solid()
    top_bar.fill.fore_color.rgb = ACCENT
    top_bar.line.fill.background()

    if is_cover:
        # 封面大标题居中
        tf = slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(11.33), Inches(1.5))
        p = tf.text_frame.paragraphs[0]
        p.text = title_text
        p.alignment = PP_ALIGN.CENTER
        r = p.runs[0]; r.font.size = Pt(36); r.font.bold = True; r.font.color.rgb = WHITE
        if subtitle_text:
            tf2 = slide.shapes.add_textbox(Inches(1), Inches(4.2), Inches(11.33), Inches(0.6))
            p2 = tf2.text_frame.paragraphs[0]
            p2.text = subtitle_text
            p2.alignment = PP_ALIGN.CENTER
            r2 = p2.runs[0]; r2.font.size = Pt(18); r2.font.color.rgb = ACCENT
        return slide

    # 标题栏
    title_bar = slide.shapes.add_shape(1, 0, Inches(0.08), prs.slide_width, Inches(0.9))
    title_bar.fill.solid(); title_bar.fill.fore_color.rgb = RGBColor(0x0d, 0x14, 0x2a)
    title_bar.line.fill.background()
    tf_title = slide.shapes.add_textbox(Inches(0.3), Inches(0.15), Inches(12), Inches(0.7))
    p = tf_title.text_frame.paragraphs[0]
    p.text = title_text[:60] if title_text else ''
    r = p.runs[0] if p.runs else p.add_run()
    r.font.size = Pt(22); r.font.bold = True; r.font.color.rgb = ACCENT

    # 副标题
    y_start = Inches(1.15)
    if subtitle_text:
        tf_sub = slide.shapes.add_textbox(Inches(0.4), y_start, Inches(12.5), Inches(0.45))
        ps = tf_sub.text_frame.paragraphs[0]
        ps.text = subtitle_text[:80]
        rs = ps.runs[0] if ps.runs else ps.add_run()
        rs.font.size = Pt(13); rs.font.color.rgb = ORANGE
        y_start += Inches(0.5)

    # 内容区（列表或段落）
    content_items = (items or []) + (paras or [])
    if content_items:
        tf_body = slide.shapes.add_textbox(Inches(0.4), y_start, Inches(12.5), Inches(7.5) - y_start - Inches(0.3))
        tf_body.text_frame.word_wrap = True
        for idx, item in enumerate(content_items[:18]):  # 最多18条
            if idx == 0:
                p_body = tf_body.text_frame.paragraphs[0]
            else:
                p_body = tf_body.text_frame.add_paragraph()
            bullet = '• ' if items and idx < len(items) else ''
            p_body.text = bullet + item[:120]
            r_body = p_body.runs[0] if p_body.runs else p_body.add_run()
            r_body.font.size = Pt(12)
            r_body.font.color.rgb = WHITE if idx < len(items or []) else GRAY
            p_body.space_after = Pt(4)

    return slide

# 首页封面
add_slide(f'{shop_name} 运营方案', '数字化经营全案 · AI智能生成', is_cover=True)

# 逐章节转换
for sec in sections[:30]:  # 最多30页
    if not sec.strip() or len(strip_tags(sec)) < 20:
        continue
    title, subtitle, items, paras = extract_text_blocks(sec)
    if not title and not items and not paras:
        continue
    add_slide(title or '内容', subtitle, items[:15], paras[:5])

# 尾页
end_slide = prs.slides.add_slide(blank_layout)
bg = end_slide.background.fill; bg.solid(); bg.fore_color.rgb = DARK_BG
tf_end = end_slide.shapes.add_textbox(Inches(1), Inches(3), Inches(11.33), Inches(1))
p_end = tf_end.text_frame.paragraphs[0]
p_end.text = f'{shop_name} × 美团餐饮SaaS'
p_end.alignment = PP_ALIGN.CENTER
r_end = p_end.runs[0]; r_end.font.size = Pt(24); r_end.font.bold = True; r_end.font.color.rgb = WHITE

prs.save(pptx_path)
print(f'PPTX生成成功: {len(prs.slides)}页')
`;
  const tmpScript = `/tmp/h2pptx_${planId}.py`;
  fs.writeFileSync(tmpScript, script);
  const r = spawnSync('python3', [tmpScript, htmlPath, pptxPath, shopName || ''], {
    encoding: 'utf8', timeout: 120000
  });
  try { fs.unlinkSync(tmpScript); } catch(e) {}
  if (r.status === 0 && fs.existsSync(pptxPath)) {
    console.log(`[${planId}] PPTX生成成功: ${pptxPath}\n${r.stdout?.slice(0,200)}`);
    return true;
  }
  console.log(`[${planId}] PPTX生成失败: ${(r.stderr||'').slice(0,300)}`);
  return false;
}

// ── HTML → DOCX（使用 pandoc，失败降级 python-docx）────────────────

async function htmlToDocx(htmlPath, docxPath, planId, shopName) {
  console.log(`[${planId}] HTML → DOCX 转换中...`);

  // 方案一：pandoc（速度最快，格式保真）
  const pandoc = spawnSync('pandoc', [htmlPath, '-o', docxPath, '--standalone'], {
    encoding: 'utf8', timeout: 60000
  });
  if (pandoc.status === 0 && fs.existsSync(docxPath)) {
    console.log(`[${planId}] DOCX生成成功（pandoc）`);
    return true;
  }
  console.log(`[${planId}] pandoc失败，降级python-docx: ${(pandoc.stderr||'').slice(0,200)}`);

  // 方案二：python-docx（从HTML提取文本）
  const script = `
import sys, re
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

html_path = sys.argv[1]
docx_path = sys.argv[2]
shop_name = sys.argv[3] if len(sys.argv) > 3 else '方案'

with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

def strip_tags(s):
    return re.sub(r'<[^>]+>', '', s).strip()

doc = Document()
# 封面标题
title_p = doc.add_paragraph()
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title_p.add_run(f'{shop_name} 运营方案')
run.bold = True
run.font.size = Pt(24)
run.font.color.rgb = RGBColor(0x0a, 0x0e, 0x1a)

# 逐段提取内容
for tag, level in [('h1',1),('h2',2),('h3',3),('h4',3)]:
    for m in re.finditer(f'<{tag}[^>]*>(.*?)</{tag}>', html, re.DOTALL):
        text = strip_tags(m.group(1))
        if text:
            doc.add_heading(text, level=level)

# 提取列表项和段落
for m in re.finditer(r'<li[^>]*>(.*?)</li>', html, re.DOTALL):
    text = strip_tags(m.group(1))
    if text and len(text) > 5:
        p = doc.add_paragraph(style='List Bullet')
        p.add_run(text)

for m in re.finditer(r'<p[^>]*>(.*?)</p>', html, re.DOTALL):
    text = strip_tags(m.group(1))
    if text and len(text) > 10:
        doc.add_paragraph(text)

doc.save(docx_path)
print(f'DOCX生成成功')
`;
  const tmpScript = `/tmp/h2docx_${planId}.py`;
  fs.writeFileSync(tmpScript, script);
  const r = spawnSync('python3', [tmpScript, htmlPath, docxPath, shopName || ''], {
    encoding: 'utf8', timeout: 60000
  });
  try { fs.unlinkSync(tmpScript); } catch {}
  if (r.status === 0 && fs.existsSync(docxPath)) {
    console.log(`[${planId}] DOCX生成成功（python-docx）`);
    return true;
  }
  console.log(`[${planId}] DOCX生成失败: ${(r.stderr||'').slice(0,300)}`);
  return false;
}

// ── 大象卡片通知 + 文件直发 ──────────────────────────────────────────

const DX_CLIENT_ID = 'aed2320a23';
const DX_CLIENT_SECRET = '4294bffbd10b41c3a1057501794077e4';
const DX_TOKEN_ENDPOINT = 'https://ssosv.sankuai.com/sson/auth/oidc/v1/token';
const DX_CARD_ENDPOINT = 'https://xopen.sankuai.com/open-apis/card/sendExclusionCard';
const DX_FILE_ENDPOINT = 'https://xopen.sankuai.com/open-apis/dx-msg/sendChatMsgByRobot';
const DX_CARD_TEMPLATE_ID = '51642';  // 方案做好咯
const DX_CARD_AUDIENCE = '873b144915'; // 大象卡片 clientId（线上）
const DX_UID_QUERY_ENDPOINT = 'https://xopen.sankuai.com/open-apis/dx/queryEmpIdentityByMisList';
const DX_MIS_AUDIENCE = 'xm-xai'; // 大象用户查询 clientId（线上）

// Token 缓存（有效期约3小时，避免每次都重新获取）
const _tokenCache = {};

/** 获取 accessToken（audience 可选，默认卡片 audience）*/
async function getDxAccessToken(audience = DX_CARD_AUDIENCE) {
  const now = Date.now();
  if (_tokenCache[audience] && _tokenCache[audience].expireAt > now + 60000) {
    return _tokenCache[audience].token;
  }
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
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`取Token失败: ${JSON.stringify(data)}`);
  _tokenCache[audience] = { token: data.access_token, expireAt: now + (data.expires_in || 10800) * 1000 };
  return data.access_token;
}

/**
 * 通过机器人直发文件给用户
 * fileUrl: Supabase Storage 公开URL
 * fileName: 显示文件名（含扩展名）
 * fileExt: 'html' | 'pptx' | 'pdf' | 'docx'
 */
async function sendFileByRobot(empId, fileUrl, fileName, fileExt) {
  const mimeTypes = {
    html: 'text/html',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  const token = await getDxAccessToken(DX_MIS_AUDIENCE);
  const fileBody = JSON.stringify({
    id: '',
    url: fileUrl,
    name: fileName,
    format: mimeTypes[fileExt] || 'application/octet-stream',
    size: 0,
  });

  const payload = {
    receiverIds: [Number(empId)],
    sendMsgInfo: {
      type: 'file',
      body: fileBody,
    },
  };

  const resp = await fetch(DX_FILE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok || data?.status?.code !== 0) {
    throw new Error(`文件直发失败: ${JSON.stringify(data?.status || data)}`);
  }
  return true;
}

/** 根据 MIS 查询 empId（用于卡片推送）*/
async function getEmpIdByMis(mis) {
  try {
    const token = await getDxAccessToken(DX_MIS_AUDIENCE);
    const resp = await fetch(DX_UID_QUERY_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ misList: [mis] }),
    });
    const data = await resp.json();
    if (data?.status?.code === 0 && data?.data?.data?.[mis]?.empId) {
      return data.data.data[mis].empId; // Long number
    }
    console.log(`[mis→empId] 查询失败: ${JSON.stringify(data?.status)}`);
    return null;
  } catch (e) {
    console.log(`[mis→empId] 异常: ${e.message}`);
    return null;
  }
}

/** MIS → 大象UID 映射表（持久化文件，找不到时降级文字通知）*/
let MIS_UID_MAP = {};
try {
  const mapPath = new URL('./mis_uid_map.json', import.meta.url).pathname;
  MIS_UID_MAP = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch { /* 文件不存在时降级为空 */ }

/**
 * 发送大象卡片通知
 * - 优先用 mis 查 empId（动态查询）
 * - 查不到时降级查 mis_uid_map.json（静态兜底）
 * - 卡片发送失败时降级为文字消息队列
 */
async function sendDaxiangNotify(planId, shopName, uid, mis, summary) {
  // 动态查询 empId
  let empId = null;
  if (mis) {
    empId = await getEmpIdByMis(mis);
  }
  // 降级：查静态映射表
  if (!empId) {
    empId = MIS_UID_MAP[mis] || null;
  }
  if (!empId) {
    console.log(`[${planId}] 无法发通知：mis=${mis} 无法解析出 empId`);
    return;
  }

  // 内部方案详情页（美团员工用）
  const internalUrl = `https://lion-plan-factory.mynocode.host/plan/detail?id=${planId}`;
  // 优先用 DB 里已存的公开分享地址（GitHub Pages），没有就用内网地址
  // plan_share_url 由 plan_finalize.js 主流程在 CDN 上传成功后写入
  let planUrl = internalUrl; // 默认内网地址，下方异步查 DB 后可能替换为公开 CDN 地址

  // 从 DB 读 plan_share_url（异步，可能是 notify-only 模式里已有）
  try {
    const freshPlan = await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${planId}&select=plan_share_url`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
    }).then(r => r.json()).then(rows => rows[0] || {});
    if (freshPlan.plan_share_url) {
      planUrl = freshPlan.plan_share_url;
    }
  } catch { /* 查不到就用内网地址 */ }
  const finishTime = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).replace(/\//g, '-');

  // ── 尝试发卡片 ───────────────────────────────────────────────────────
  try {
    const accessToken = await getDxAccessToken();
    const requestId = `plan_${planId}_notify_${Date.now()}`;
    const payload = {
      requestId,
      serialNum: crypto.randomUUID(),
      fieldTypes: ['PUB_CHAT'],
      cardFieldData: {
        imBotChat: { empIds: [empId] }
      },
      cardData: {
        publicData: {
          templateId: DX_CARD_TEMPLATE_ID,
          variableValue: JSON.stringify({
            shop_name: shopName,
            finish_time: finishTime,
            plan_url: planUrl,
            plan_abstract: summary || `「${shopName}」运营方案已制作完成，点击查看完整方案`
          }),
          abstractText: `${shopName}的运营方案已生成，点击查看`
        },
        version: 1
      },
      cardOption: { updateType: 'PUSH' }
    };

    const cardResp = await fetch(DX_CARD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': accessToken,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
    const cardData = await cardResp.json();

    if (cardResp.ok && cardData?.status?.code === 0) {
      console.log(`[${planId}] ✅ 大象卡片通知发送成功 → empId=${empId}`);
      // 写回 notified_at
      await updatePlan(planId, { notified_at: new Date().toISOString() }).catch(e => {
        console.log(`[${planId}] ⚠️ notified_at 写回失败: ${e.message}`);
      });
      return;
    }
    // 权限不足时降级
    console.log(`[${planId}] ⚠️ 卡片发送失败(${cardData?.status?.code}): ${cardData?.status?.msg}，降级文字通知`);
  } catch (e) {
    console.log(`[${planId}] ⚠️ 卡片发送异常: ${e.message}，降级文字通知`);
  }

  // ── 降级：写入文字通知队列（兜底） ──────────────────────────────────
  const message = `🎉 你的运营方案已生成完毕！\n\n📋 门店：${shopName}\n\n👉 点击查看方案：\n${planUrl}\n\n（登录后在「我的方案」里找到该方案，点击查看详情）`;
  const PENDING_NOTIF_FILE = '/tmp/pending_notifications.json';
  try {
    let pending = [];
    try { pending = JSON.parse(fs.readFileSync(PENDING_NOTIF_FILE, 'utf8')); } catch { /* 空 */ }
    pending.push({ target: String(empId), message, label: `plan_${planId}_done`, ts: Date.now() });
    fs.writeFileSync(PENDING_NOTIF_FILE, JSON.stringify(pending, null, 2));
    console.log(`[${planId}] 📝 文字通知已写入队列 → ${empId}`);
    console.log(`[ACTION_REQUIRED] 请用 message tool 发送以下大象通知：`);
    console.log(`NOTIFY target=${empId} message=${JSON.stringify(message)}`);
  } catch (e2) {
    console.log(`[${planId}] ⚠️ 通知队列写入失败(忽略): ${e2.message}`);
  }
}

// ── 文件直发队列（写入 GitHub crm/file_send_queue.json）──────────────

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO = 'maoliang-mt/maoliang-crm';
const QUEUE_FILE_PATH = 'crm/file_send_queue.json';

async function enqueueFileSend({ planId, mis, shopName, fileUrl, fileType }) {
  if (!fileUrl) {
    console.log(`[${planId}] 无文件URL，跳过文件直发队列`);
    return;
  }
  if (!mis) {
    console.log(`[${planId}] mis为空，跳过文件直发队列`);
    return;
  }

  // 1. 读取当前队列（GitHub API）
  const headers = {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'plan-finalize'
  };
  const getRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${QUEUE_FILE_PATH}`, { headers });
  if (!getRes.ok) throw new Error(`读取队列文件失败: ${getRes.status}`);
  const ghFile = await getRes.json();
  const currentQueue = JSON.parse(Buffer.from(ghFile.content, 'base64').toString('utf8'));

  // 2. 追加新任务
  const newTask = {
    id: `${planId}_${Date.now()}`,
    planId: Number(planId),
    mis,
    shopName,
    fileUrl,
    fileType: fileType || 'html',
    fileName: `${shopName}_运营方案.${fileType || 'html'}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sentAt: null,
    error: null
  };
  currentQueue.push(newTask);

  // 3. 写回 GitHub
  const updatedContent = Buffer.from(JSON.stringify(currentQueue, null, 2)).toString('base64');
  const putRes = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${QUEUE_FILE_PATH}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `[plan-factory] 加入文件发送队列 plan#${planId} ${shopName}`,
      content: updatedContent,
      sha: ghFile.sha
    })
  });
  if (!putRes.ok) throw new Error(`写入队列文件失败: ${putRes.status} ${await putRes.text()}`);
  console.log(`[${planId}] ✅ 已加入文件发送队列: ${fileUrl}`);
}

// ── 主流程 ────────────────────────────────────────────────────────────

async function main() {
  const [,, planId, filePath] = process.argv;
  if (!planId) {
    console.error('用法: node plan_finalize.js <plan_id> [file_path|--notify-only]');
    process.exit(1);
  }

  // --notify-only 模式：方案已生成，只补发通知
  if (filePath === '--notify-only' || !filePath) {
    console.log(`[${planId}] 📣 notify-only 模式`);
    const plan = await getPlan(planId);
    if (!plan) { console.error(`[${planId}] 找不到方案`); process.exit(1); }
    if (plan.notified_at) { console.log(`[${planId}] 已通知过(${plan.notified_at})，跳过`); process.exit(0); }
    const summary = plan.plan_abstract || plan.summary || null;
    if (!plan.mis) {
      console.log(`[${planId}] ⚠️ mis 字段为空，跳过大象通知（请在 DB 补充 mis 后手动运行 --notify-only）`);
    } else {
      await sendDaxiangNotify(planId, plan.shop_name || `方案${planId}`, null, plan.mis, summary);
    }
    process.exit(0);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    await updatePlan(planId, { status: 'pending' });
    process.exit(1);
  }

  const ts = Date.now();
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const plan = await getPlan(planId);
  const shopName = plan.shop_name || `方案${planId}`;

  console.log(`[${planId}] 开始处理: ${shopName} (${ext})`);

  let planFileUrl = null;
  let planPptxUrl = null;
  let planHtmlContent = null;
  const extraFields = {}; // 额外字段（如 plan_html_url）

  // ── 提取 SUMMARY 摘要（大橘在stdout中输出 SUMMARY:xxx）─────────────
  // plan_finalize 由大橘调用，摘要从调用方写入临时文件或通过环境变量传递
  // 大橘任务输出 SUMMARY: 行，worker 读取后写入 /tmp/plan_summary_<id>.txt
  let extractedSummary = null;
  const summaryFile = `/tmp/plan_summary_${planId}.txt`;
  if (fs.existsSync(summaryFile)) {
    try {
      extractedSummary = fs.readFileSync(summaryFile, 'utf8').trim();
      if (extractedSummary) {
        console.log(`[${planId}] 读取摘要: ${extractedSummary.slice(0, 80)}...`);
      }
      fs.unlinkSync(summaryFile);
    } catch(e) { extractedSummary = null; }
  }
  // 备用：从环境变量读取
  if (!extractedSummary && process.env.PLAN_SUMMARY) {
    extractedSummary = process.env.PLAN_SUMMARY.trim();
  }

  if (ext === 'html') {
    // ── HTML格式：推 Supabase Storage（国内访问快），同时推 GitHub Pages CDN（外部分享用）──
    const ts2 = Date.now();
    const htmlFileName = `plan_${planId}_${ts2}.html`;

    // 1. 优先推 Supabase Storage（国内节点，前端直接 fetch 渲染用）
    let htmlStorageUrl = null;
    try {
      htmlStorageUrl = await uploadToSupabase(filePath, htmlFileName);
      console.log(`[${planId}] HTML已推送至Supabase Storage: ${htmlStorageUrl}`);
    } catch (e) {
      console.log(`[${planId}] HTML推送Supabase Storage失败: ${e.message}`);
    }

    // 2. 同时推 GitHub Pages CDN（给外部分享链接用，失败不影响）
    // plan_share_url 存 GitHub Pages 公开地址（客户可直接访问）
    // plan_html_url 存 Supabase Storage 地址（前端快速渲染用）
    try {
      const htmlCdnUrl = await uploadToCDN(filePath, planId);
      console.log(`[${planId}] HTML源文件已推送至GitHub Pages CDN: ${htmlCdnUrl}`);
      // CDN推送成功：用公开地址作为卡片链接
      Object.assign(extraFields, { plan_share_url: htmlCdnUrl });
      // planUrl 不在这里赋值——sendDaxiangNotify 内部自己从 DB 读 plan_share_url
    } catch (e) {
      // Fix 6: CDN 失败时不写 plan_share_url，卡片链接保持内网地址（可访问，不会404）
      console.log(`[${planId}] HTML源文件推送CDN失败，使用内网链接: ${e.message}`);
    }

    // 把 Supabase Storage URL 存入 plan_html_url（前端用来快速加载）
    if (htmlStorageUrl) {
      planHtmlContent = null; // 不再存大字段到DB
      // 将 URL 通过 dbFields 写入（下方单独处理）
      Object.assign(extraFields, { plan_html_url: htmlStorageUrl });
    } else {
      // 上传失败：回滚到 pending，让 queue worker 重新调度生成
      console.error(`[${planId}] HTML上传失败，回滚状态为 pending 等待重试`);
      await updatePlan(planId, { status: 'pending', updated_at: new Date().toISOString() });
      process.exit(1);
    }

    // 根据 output_format 自动转换附加格式并上传
    // 支持格式：docx / pptx / html（PDF已移除 2026-05-24）
    const outputFmt = (plan.output_format || '').toLowerCase();
    const safeName = shopName.replace(/[^\w\u4e00-\u9fa5]/g, '_');
    let docxFileUrl = null;
    // pptxFileUrl 复用 planPptxUrl（已声明）

    // 格式匹配：兼容两种值风格
    // DB直写: 'word'/'pptx'/'html'  前端dropdown: 'both'/'all'/'word_only'/'html_only'/'ppt_only'/'word_ppt'
    const needDocx = outputFmt.includes('docx') || outputFmt.includes('word') || outputFmt === 'both' || outputFmt === 'all';
    const needPptx = outputFmt.includes('pptx') || outputFmt === 'all' || outputFmt === 'ppt_only' || outputFmt === 'word_ppt';

    if (needDocx) {
      const docxPath = filePath.replace(/\.html$/i, '.docx');
      console.log(`[${planId}] output_format 含 docx，开始 HTML→DOCX 转换...`);
      const docxOk = await htmlToDocx(filePath, docxPath, planId, shopName);
      if (docxOk) {
        try {
          docxFileUrl = await uploadToSupabase(docxPath, `plans/${planId}/${safeName}_plan.docx`);
          console.log(`[${planId}] DOCX上传成功: ${docxFileUrl}`);
        } catch (e) {
          console.log(`[${planId}] DOCX上传失败(不影响HTML): ${e.message}`);
        }
        try { fs.unlinkSync(docxPath); } catch {}
      } else {
        console.log(`[${planId}] DOCX转换失败，跳过（HTML仍可用）`);
      }
    }

    if (needPptx) {
      const pptxPath = filePath.replace(/\.html$/i, '.pptx');
      console.log(`[${planId}] output_format 含 pptx，开始 HTML→PPTX 转换...`);
      const pptxOk = await htmlToPptx(filePath, pptxPath, planId, shopName);
      if (pptxOk) {
        try {
          planPptxUrl = await uploadToSupabase(pptxPath, `plans/${planId}/${safeName}_plan.pptx`);
          console.log(`[${planId}] PPTX上传成功: ${planPptxUrl}`);
        } catch (e) {
          console.log(`[${planId}] PPTX上传失败(不影响HTML): ${e.message}`);
        }
        try { fs.unlinkSync(pptxPath); } catch {}
      } else {
        console.log(`[${planId}] PPTX转换失败，跳过（HTML仍可用）`);
      }
    }

    // plan_file_url 按优先级取第一个成功的
    planFileUrl = docxFileUrl || planPptxUrl || null;

  } else if (ext === 'pptx') {
    // ── PPTX格式：直接上传 ────────────────────────────────────────────
    planPptxUrl = await uploadFile(filePath, `plan_${planId}_${ts}.pptx`);
    planFileUrl = planPptxUrl;
    console.log(`[${planId}] PPTX上传: ${planPptxUrl}`);

  } else {
    // ── 其他格式（docx等）────────────────────────────────────────────
    planFileUrl = await uploadFile(filePath, `plan_${planId}_${ts}.${ext}`);
    console.log(`[${planId}] 文件上传: ${planFileUrl}`);
  }

  // 计算盈利估算数据（基于 avg_price / monthly_revenue）
  const profitData = estimateProfitData(plan);
  if (profitData) {
    console.log(`[${planId}] 盈利估算完成: 利润率${profitData.estimatedProfitRate}%, 储值档位${profitData.storageTiers.length}个`);
  }

  // 更新数据库
  const dbFields = {
    status: 'published',
    is_public: false,
    ...(planFileUrl && { plan_file_url: planFileUrl }),
    ...(planPptxUrl && { plan_pptx_url: planPptxUrl }),
    ...(planHtmlContent && { plan_html_content: planHtmlContent }),
    ...(extractedSummary && { summary: extractedSummary }),
    ...(profitData && { profit_data: profitData }),
    ...extraFields
  };
  await updatePlan(planId, dbFields);
  console.log(`[${planId}] DB已更新 → status=published, file=${!!planFileUrl}, pptx=${!!planPptxUrl}, html=${!!planHtmlContent}, htmlUrl=${!!extraFields.plan_html_url}, shareUrl=${extraFields.plan_share_url || '无'}, profitData=${!!profitData}`);

  // 发大象通知（方案完成通知给提交者）
  if (!plan.mis) {
    console.log(`[${planId}] ⚠️ mis 字段为空，跳过大象通知（请在 DB 补充 mis 后手动运行 --notify-only）`);
  } else {
    await sendDaxiangNotify(planId, shopName, null, plan.mis, extractedSummary);
  }

  // ── 文件直发（通过机器人API直接发大象文件消息）────────────────────
  // 优先级：plan_file_url(PDF) > plan_pptx_url > plan_html_url
  try {
    const empId = await getEmpIdByMis(plan.mis);
    if (empId) {
      // 选文件：有啥发啥，不做格式转换
      let sendFileUrl = planFileUrl || planPptxUrl || extraFields.plan_html_url;
      let sendFileExt = planFileUrl ? path.extname(planFileUrl).slice(1).toLowerCase()
                      : planPptxUrl ? 'pptx'
                      : 'html';
      let sendFileName = `${shopName}_运营方案.${sendFileExt}`;

      if (sendFileUrl) {
        await sendFileByRobot(empId, sendFileUrl, sendFileName, sendFileExt);
        console.log(`[${planId}] ✅ 文件直发成功 → empId=${empId} url=${sendFileUrl}`);
      } else {
        console.log(`[${planId}] ⚠️ 无可发送的文件URL，跳过文件直发`);
      }
    } else {
      console.log(`[${planId}] ⚠️ 无法解析 empId，跳过文件直发`);
    }
  } catch (e) {
    console.log(`[${planId}] ⚠️ 文件直发失败（不影响主流程）: ${e.message}`);
  }

  // 清理临时文件
  try { fs.unlinkSync(filePath); } catch(e) {}

  // 清除重试计数（方案成功，不再需要跟踪）
  try {
    const RETRY_FILE = '/root/.openclaw/workspace/agents/.plan_retry_counts.json';
    if (fs.existsSync(RETRY_FILE)) {
      const counts = JSON.parse(fs.readFileSync(RETRY_FILE, 'utf8'));
      delete counts[String(planId)];
      fs.writeFileSync(RETRY_FILE, JSON.stringify(counts, null, 2));
    }
  } catch {}

  console.log(`[${planId}] 处理完成 ✅`);
}

main().catch(async err => {
  console.error('收割脚本异常:', err.message);
  const planId = process.argv[2];
  if (planId) {
    await fetch(`${SUPABASE_URL}/rest/v1/plans?id=eq.${planId}`, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() })
    }).catch(() => {});
    console.log(`[${planId}] 已回滚为pending`);
  }
  process.exit(1);
});
