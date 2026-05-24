/**
 * 门店盈利计算器 - Web Component
 * 可嵌入任意 HTML 页面: <store-profit-calculator></store-profit-calculator>
 *
 * 属性:
 *   preset="chinese"       - 预设业态 (fastfood/chinese/hotpot/bbq/cafe)
 *   mode="full"             - 显示模式: full(完整) | embed(嵌入,无header) | mini(仅结果)
 *   theme="light"           - 主题: light / dark
 *
 * 事件:
 *   @result  - 计算结果变化时触发, event.detail = 计算结果对象
 *
 * 方法:
 *   .getResult()            - 获取当前计算结果
 *   .setData({...})         - 编程式填充数据
 *   .reset()                - 重置
 */

import { calcStoreProfit, presets, diagnose, formatMoney, formatMoneyFull, getVerdict } from './engine.js';

class StoreProfitCalculator extends HTMLElement {

  // 声明可观察属性
  static get observedAttributes() {
    return ['preset', 'mode', 'theme'];
  }

  constructor() {
    super();
    this._result = null;
    this._shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    // 如果有预设，立即填充
    const preset = this.getAttribute('preset');
    if (preset && presets[preset]) {
      this.setData(presets[preset]);
    } else {
      this._calc();
    }
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (name === 'preset' && presets[newVal]) {
      this.setData(presets[newVal]);
    }
    if (name === 'mode' || name === 'theme') {
      this.render();
      this._calc();
    }
  }

  // ========== 公开 API ==========

  getResult() {
    return this._result;
  }

  setData(data) {
    const fieldMap = {
      area: 'f_area', seatArea: 'f_seatArea', seatsPerTable: 'f_seatsPerTable',
      turnover: 'f_turnover', openDays: 'f_openDays', takeoutPct: 'f_takeoutPct',
      avgTableSpend: 'f_avgTableSpend', avgPerPerson: 'f_avgPerPerson',
      takeoutAvgPrice: 'f_takeoutAvgPrice', rent: 'f_rent',
      chefCount: 'f_chefCount', chefSalary: 'f_chefSalary',
      waiterCount: 'f_waiterCount', waiterSalary: 'f_waiterSalary',
      mgrCount: 'f_mgrCount', mgrSalary: 'f_mgrSalary',
      foodCostRate: 'f_foodCostRate', utilities: 'f_utilities',
      takeoutCommission: 'f_takeoutCommission', otherCost: 'f_otherCost'
    };
    const $ = s => this._shadow.getElementById(s);
    Object.entries(fieldMap).forEach(([key, id]) => {
      const el = $(id);
      if (el && data[key] !== undefined) el.value = data[key];
    });
    this._calc();
  }

  reset() {
    this.setData({ area: 0, seatArea: 1.8, seatsPerTable: 4, turnover: 0, openDays: 30, takeoutPct: 20,
      avgTableSpend: 0, avgPerPerson: 0, takeoutAvgPrice: 0, rent: 0,
      chefCount: 0, chefSalary: 0, waiterCount: 0, waiterSalary: 0, mgrCount: 0, mgrSalary: 0,
      foodCostRate: 35, utilities: 0, takeoutCommission: 18, otherCost: 0
    });
  }

  // ========== 内部方法 ==========

  _getInputData() {
    const $ = s => this._shadow.getElementById(s);
    const v = id => { const el = $(id); return el && el.value ? parseFloat(el.value) : 0; };
    return {
      area: v('f_area'), seatArea: v('f_seatArea') || 1.8, seatsPerTable: v('f_seatsPerTable') || 4,
      turnover: v('f_turnover'), openDays: v('f_openDays') || 30, takeoutPct: v('f_takeoutPct'),
      avgTableSpend: v('f_avgTableSpend'), avgPerPerson: v('f_avgPerPerson'),
      takeoutAvgPrice: v('f_takeoutAvgPrice'), rent: v('f_rent'),
      chefCount: v('f_chefCount'), chefSalary: v('f_chefSalary'),
      waiterCount: v('f_waiterCount'), waiterSalary: v('f_waiterSalary'),
      mgrCount: v('f_mgrCount'), mgrSalary: v('f_mgrSalary'),
      foodCostRate: v('f_foodCostRate'), utilities: v('f_utilities'),
      takeoutCommission: v('f_takeoutCommission'), otherCost: v('f_otherCost')
    };
  }

  _calc() {
    const data = this._getInputData();
    this._result = calcStoreProfit(data);
    this._updateUI(this._result);
    this.dispatchEvent(new CustomEvent('result', { detail: this._result, bubbles: true }));
  }

  _updateUI(r) {
    const $ = s => this._shadow.getElementById(s);
    const mode = this.getAttribute('mode') || 'full';

    // Big profit
    const bigEl = $('bigProfit');
    if (bigEl) {
      if (r.totalRevenue === 0) {
        bigEl.textContent = '--';
        bigEl.className = 'spc-big-value zero';
        $('bigProfitSub').textContent = '';
        $('verdictBadge').style.display = 'none';
        $('healthFill').style.width = '0%';
      } else {
        const verdict = getVerdict(r.profitRate);
        bigEl.textContent = (r.monthProfit >= 0 ? '+' : '') + formatMoneyFull(Math.round(r.monthProfit)) + ' 元';
        bigEl.className = 'spc-big-value ' + (r.monthProfit > 0 ? 'positive' : r.monthProfit < 0 ? 'negative' : 'zero');

        $('bigProfitSub').textContent = '年利润 ' + formatMoney(Math.round(r.yearProfit));
        $('bigProfitSub').className = 'spc-sub-value ' + (r.monthProfit >= 0 ? 'positive' : 'negative');

        const badge = $('verdictBadge');
        badge.style.display = 'inline-block';
        badge.textContent = verdict.label + ' — ' + verdict.desc;
        badge.className = 'spc-verdict ' + verdict.css;

        const fill = $('healthFill');
        const hp = Math.max(0, Math.min(100, r.profitRate * 2.5 + 25));
        fill.style.width = hp + '%';
        fill.style.background = r.profitRate >= 15 ? '#10B981' : r.profitRate >= 5 ? '#F59E0B' : '#EF4444';
      }
    }

    // Summary cards
    const setT = (id, t) => { const e = $(id); if (e) e.textContent = t; };
    setT('totalRevenue', formatMoney(Math.round(r.totalRevenue)));
    setT('totalRevenueSub', `堂食 ${formatMoney(Math.round(r.monthlyDineInRevenue))} · 外卖 ${formatMoney(Math.round(r.monthlyTakeoutRevenue))}`);
    setT('totalCost', formatMoney(Math.round(r.totalCost)));
    setT('totalCostSub', `食材${r.totalRevenue > 0 ? r.foodCostRatio.toFixed(0) + '%' : '--'} · 人工${formatMoney(Math.round(r.laborCost))}`);
    setT('monthProfit', formatMoney(Math.round(r.monthProfit)));
    setT('monthProfitSub', `年利润 ${formatMoney(Math.round(r.yearProfit))}`);
    setT('profitRate', r.totalRevenue > 0 ? r.profitRate.toFixed(1) + '%' : '--');
    setT('profitRateSub', `房租占比 ${r.rentRatio.toFixed(1)}% · 人工占比 ${r.laborRatio.toFixed(1)}%`);

    // Breakdown table
    const tbody = $('breakdownBody');
    if (tbody) {
      if (r.totalRevenue === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#6B7280;padding:24px;">请填写左侧数据</td></tr>';
      } else {
        let html = '';
        const icons = { rent:'🏠', chef:'👨‍🍳', waiter:'🧑‍🍳', manager:'👔', food:'🥬', utilities:'💡', takeoutFee:'📱', other:'📦' };
        const bgs = { rent:'#DBEAFE', chef:'#FEF3C7', waiter:'#FCE7F3', manager:'#E0E7FF', food:'#D1FAE5', utilities:'#E9D5FF', takeoutFee:'#FEE2E2', other:'#F3F4F6' };
        r.costBreakdown.forEach(item => {
          html += `<tr>
            <td><span class="spc-cat-icon" style="background:${bgs[item.key]}">${icons[item.key] || '📦'}</span>${item.name}${item.detail ? '<br><span style="font-size:11px;color:#6B7280">' + item.detail + '</span>' : ''}</td>
            <td class="spc-amount">${formatMoneyFull(Math.round(item.amount))} 元</td>
            <td class="spc-pct">${item.pctOfRevenue}%</td>
          </tr>`;
        });
        html += `<tr class="spc-total-row"><td><strong>合计</strong></td><td class="spc-amount">${formatMoneyFull(Math.round(r.totalCost))} 元</td><td class="spc-pct">100%</td></tr>`;
        tbody.innerHTML = html;
      }
    }

    // Sensitivity
    const sensArea = $('sensitivityArea');
    if (sensArea) {
      if (r.totalRevenue === 0) {
        sensArea.innerHTML = '<div style="text-align:center;color:#6B7280;padding:16px;font-size:13px;">填写数据后自动计算</div>';
      } else {
        let html = '';
        r.sensitivity.forEach(s => {
          const isUp = s.impact > 0;
          html += `<div class="spc-sens-row">
            <span class="spc-sens-label">${s.factor} ±10%</span>
            <span><span class="spc-sens-val ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${formatMoneyFull(s.impact)} 元</span>
            <span style="font-size:11px;color:#6B7280;margin-left:6px">(利润${isUp ? '增' : '减'}${Math.abs(s.pctOfProfit)}%)</span></span>
          </div>`;
        });
        sensArea.innerHTML = html;
      }
    }
  }

  // ========== 渲染 ==========

  render() {
    const mode = this.getAttribute('mode') || 'full';
    const theme = this.getAttribute('theme') || 'light';
    const isDark = theme === 'dark';
    const showInput = mode !== 'mini';
    const showHeader = mode === 'full';

    this._shadow.innerHTML = `
<style>
${this._getStyles(isDark)}
</style>

${showHeader ? `
<div class="spc-header">
  <div class="spc-logo">厂</div>
  <h1>门店盈利计算器</h1>
  <span class="spc-header-sub">方案工厂 · 实时盈亏测算</span>
</div>
` : ''}

<div class="spc-main ${mode === 'mini' ? 'spc-main-mini' : ''}">
  ${showInput ? this._renderInputPanel() : ''}
  <div class="spc-results">
    ${this._renderResults()}
  </div>
</div>
`;

    // 绑定事件
    this._shadow.querySelectorAll('.spc-input').forEach(el => {
      el.addEventListener('input', () => this._calc());
    });
    this._shadow.querySelectorAll('.spc-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.preset;
        if (presets[type]) {
          this._shadow.querySelectorAll('.spc-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.setData(presets[type]);
        }
      });
    });
    const resetBtn = this._shadow.getElementById('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
  }

  _renderInputPanel() {
    const f = (id, label, placeholder, unit, val) =>
      `<div class="spc-field">
        <label>${label}</label>
        <div class="spc-unit" data-unit="${unit}">
          <input type="number" class="spc-input" id="${id}" value="${val || ''}" placeholder="${placeholder}">
        </div>
      </div>`;

    return `
<div class="spc-input-panel">
  <div class="spc-panel-title">📋 填写门店数据</div>

  <div class="spc-tip">💡 填入门店数据，右侧实时计算盈亏</div>

  <div class="spc-preset-bar">
    <button class="spc-preset-btn" data-preset="fastfood">快餐小吃</button>
    <button class="spc-preset-btn" data-preset="chinese">中餐正餐</button>
    <button class="spc-preset-btn" data-preset="hotpot">火锅串串</button>
    <button class="spc-preset-btn" data-preset="bbq">烧烤夜宵</button>
    <button class="spc-preset-btn" data-preset="cafe">咖啡茶饮</button>
  </div>

  <div class="spc-section">
    <div class="spc-section-label">🏠 门店基础</div>
    <div class="spc-row">
      ${f('f_area','门店面积','如 120','㎡')}
      ${f('f_seatArea','每座面积','','㎡/座','1.8')}
    </div>
    <div class="spc-row">
      ${f('f_seatsPerTable','每桌座位数','','人','4')}
      ${f('f_turnover','翻台率','如 2.0','次/天')}
    </div>
    <div class="spc-row">
      ${f('f_openDays','营业天数','','天/月','30')}
      ${f('f_takeoutPct','外卖占比','不做的填0','%','0')}
    </div>
  </div>

  <div class="spc-section">
    <div class="spc-section-label">💰 营收参数</div>
    <div class="spc-row">
      ${f('f_avgTableSpend','桌均消费','如 280','元')}
      ${f('f_avgPerPerson','客单价','如 70','元')}
    </div>
    <div class="spc-row">
      ${f('f_takeoutAvgPrice','外卖客单价','默认取堂食','元')}
    </div>
  </div>

  <div class="spc-section">
    <div class="spc-section-label">🏢 固定成本</div>
    <div class="spc-row">
      ${f('f_rent','月租金','如 15000','元/月')}
    </div>
    <div class="spc-row">
      ${f('f_chefCount','厨师人数','如 2','人')}
      ${f('f_chefSalary','厨师平均工资','如 8000','元/月')}
    </div>
    <div class="spc-row">
      ${f('f_waiterCount','服务员人数','如 4','人')}
      ${f('f_waiterSalary','服务员平均工资','如 4000','元/月')}
    </div>
    <div class="spc-row">
      ${f('f_mgrCount','管理层人数','如 1','人')}
      ${f('f_mgrSalary','管理层平均工资','如 10000','元/月')}
    </div>
  </div>

  <div class="spc-section">
    <div class="spc-section-label">📊 变动成本</div>
    <div class="spc-row">
      ${f('f_foodCostRate','食材成本率','','%','35')}
      ${f('f_utilities','水电能耗','如 3000','元/月')}
    </div>
    <div class="spc-row">
      ${f('f_takeoutCommission','外卖平台抽成','','%','18')}
      ${f('f_otherCost','其他月度支出','如 2000','元')}
    </div>
  </div>

  <button id="resetBtn" class="spc-reset-btn">🔄 重置所有数据</button>
</div>`;
  }

  _renderResults() {
    return `
<div class="spc-big-profit">
  <div class="spc-big-label">月净利润</div>
  <div class="spc-big-value zero" id="bigProfit">--</div>
  <div class="spc-sub-value" id="bigProfitSub"></div>
  <div id="verdictBadge" class="spc-verdict" style="display:none"></div>
  <div class="spc-health-meter"><div class="spc-health-fill" id="healthFill"></div></div>
</div>

<div class="spc-cards">
  <div class="spc-card spc-card-revenue">
    <div class="spc-card-label">月营收</div>
    <div class="spc-card-value spc-text-primary" id="totalRevenue">--</div>
    <div class="spc-card-sub" id="totalRevenueSub"></div>
  </div>
  <div class="spc-card spc-card-cost">
    <div class="spc-card-label">月总成本</div>
    <div class="spc-card-value spc-text-danger" id="totalCost">--</div>
    <div class="spc-card-sub" id="totalCostSub"></div>
  </div>
  <div class="spc-card spc-card-profit">
    <div class="spc-card-label">月净利润</div>
    <div class="spc-card-value spc-text-success" id="monthProfit">--</div>
    <div class="spc-card-sub" id="monthProfitSub"></div>
  </div>
  <div class="spc-card spc-card-rate">
    <div class="spc-card-label">净利润率</div>
    <div class="spc-card-value spc-text-accent" id="profitRate">--</div>
    <div class="spc-card-sub" id="profitRateSub"></div>
  </div>
</div>

<div class="spc-breakdown-panel">
  <div class="spc-panel-title">📋 成本明细</div>
  <table class="spc-table">
    <thead><tr><th>项目</th><th>月度金额</th><th>占营收比</th></tr></thead>
    <tbody id="breakdownBody">
      <tr><td colspan="3" style="text-align:center;color:#6B7280;padding:24px">请填写左侧数据</td></tr>
    </tbody>
  </table>
</div>

<div class="spc-sens-panel">
  <div class="spc-panel-title">🔬 敏感性分析（变动±10%对利润的影响）</div>
  <div id="sensitivityArea">
    <div style="text-align:center;color:#6B7280;padding:16px;font-size:13px">填写数据后自动计算</div>
  </div>
</div>`;
  }

  _getStyles(isDark) {
    const bg = isDark ? '#1A1A2E' : '#F5F7FA';
    const card = isDark ? '#252540' : '#FFFFFF';
    const text = isDark ? '#E5E7EB' : '#1A1A2E';
    const textSec = isDark ? '#9CA3AF' : '#6B7280';
    const border = isDark ? '#374151' : '#E5E7EB';
    const inputBg = isDark ? '#1E1E36' : '#FAFBFC';

    return `
:host { display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: ${bg}; color: ${text}; }
* { box-sizing: border-box; margin: 0; padding: 0; }

.spc-header { background: linear-gradient(135deg, #1F4E79, #163A5C); color: white; padding: 16px 32px; display: flex; align-items: center; gap: 12px; border-radius: 12px 12px 0 0; }
.spc-logo { width: 36px; height: 36px; background: #ED7D31; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px; }
.spc-header h1 { font-size: 18px; font-weight: 700; }
.spc-header-sub { font-size: 13px; opacity: 0.8; margin-left: 8px; }

.spc-main { display: grid; grid-template-columns: 420px 1fr; gap: 24px; padding: 24px; }
.spc-main-mini { grid-template-columns: 1fr; }

.spc-input-panel { overflow-y: auto; max-height: 90vh; background: ${card}; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.spc-results { overflow-y: auto; max-height: 90vh; }

.spc-panel-title { font-size: 15px; font-weight: 700; color: #1F4E79; margin-bottom: 16px; }
.spc-tip { background: linear-gradient(135deg, #EBF5FF, #F0F9FF); border: 1px solid #BAE6FD; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #0369A1; margin-bottom: 16px; }
.spc-preset-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.spc-preset-btn { padding: 6px 14px; border-radius: 20px; border: 1.5px solid ${border}; background: ${card}; font-size: 12px; font-weight: 600; cursor: pointer; color: ${textSec}; transition: all 0.2s; }
.spc-preset-btn:hover { border-color: #2D6DA3; color: #1F4E79; background: #EBF5FF; }
.spc-preset-btn.active { border-color: #1F4E79; background: #1F4E79; color: white; }

.spc-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid ${border}; }
.spc-section:last-of-type { border-bottom: none; }
.spc-section-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: ${textSec}; margin-bottom: 12px; }
.spc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }

.spc-field { display: flex; flex-direction: column; gap: 4px; }
.spc-field label { font-size: 12px; font-weight: 500; color: ${textSec}; }
.spc-field input { height: 38px; border: 1.5px solid ${border}; border-radius: 8px; padding: 0 12px; font-size: 14px; font-weight: 500; color: ${text}; background: ${inputBg}; outline: none; width: 100%; transition: all 0.2s; }
.spc-field input:focus { border-color: #2D6DA3; box-shadow: 0 0 0 3px rgba(31,78,121,0.1); background: ${card}; }
.spc-unit { position: relative; }
.spc-unit input { padding-right: 50px !important; }
.spc-unit::after { content: attr(data-unit); position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; color: ${textSec}; pointer-events: none; }

.spc-reset-btn { width: 100%; padding: 10px; border: 1.5px dashed ${border}; border-radius: 8px; background: transparent; color: ${textSec}; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; margin-top: 12px; }
.spc-reset-btn:hover { border-color: #EF4444; color: #EF4444; background: #FEF2F2; }

.spc-big-profit { background: ${card}; border-radius: 16px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); text-align: center; margin-bottom: 24px; position: relative; overflow: hidden; }
.spc-big-profit::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #EF4444, #F59E0B, #10B981); }
.spc-big-label { font-size: 14px; font-weight: 600; color: ${textSec}; margin-bottom: 8px; }
.spc-big-value { font-size: 48px; font-weight: 900; line-height: 1.1; }
.spc-big-value.positive { color: #10B981; }
.spc-big-value.negative { color: #EF4444; }
.spc-big-value.zero { color: ${textSec}; }
.spc-sub-value { font-size: 16px; font-weight: 600; margin-top: 4px; }
.spc-sub-value.positive { color: #10B981; }
.spc-sub-value.negative { color: #EF4444; }
.spc-verdict { margin-top: 12px; padding: 8px 16px; border-radius: 20px; display: inline-block; font-size: 13px; font-weight: 600; }
.spc-verdict.good { background: #D1FAE5; color: #065F46; }
.spc-verdict.ok { background: #FEF3C7; color: #92400E; }
.spc-verdict.bad { background: #FEE2E2; color: #991B1B; }
.spc-health-meter { height: 8px; border-radius: 4px; background: #E5E7EB; overflow: hidden; margin-top: 8px; }
.spc-health-fill { height: 100%; border-radius: 4px; transition: width 0.5s, background 0.5s; }

.spc-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.spc-card { background: ${card}; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); position: relative; overflow: hidden; }
.spc-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.spc-card-revenue::before { background: #1F4E79; }
.spc-card-cost::before { background: #EF4444; }
.spc-card-profit::before { background: #10B981; }
.spc-card-rate::before { background: #ED7D31; }
.spc-card-label { font-size: 12px; font-weight: 500; color: ${textSec}; margin-bottom: 4px; }
.spc-card-value { font-size: 28px; font-weight: 800; line-height: 1.2; }
.spc-text-primary { color: #1F4E79; }
.spc-text-danger { color: #EF4444; }
.spc-text-success { color: #10B981; }
.spc-text-accent { color: #ED7D31; }
.spc-card-sub { font-size: 12px; color: ${textSec}; margin-top: 4px; }

.spc-breakdown-panel, .spc-sens-panel { background: ${card}; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px; }

.spc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.spc-table th { text-align: left; font-weight: 600; color: ${textSec}; padding: 8px 12px; border-bottom: 2px solid ${border}; font-size: 12px; }
.spc-table td { padding: 10px 12px; border-bottom: 1px solid #F3F4F6; }
.spc-amount { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.spc-pct { text-align: right; color: ${textSec}; font-size: 12px; }
.spc-total-row td { font-weight: 700; border-top: 2px solid ${border}; font-size: 14px; }
.spc-total-row .spc-amount { color: #1F4E79; }
.spc-cat-icon { width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; margin-right: 8px; vertical-align: middle; }

.spc-sens-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #F3F4F6; }
.spc-sens-row:last-child { border-bottom: none; }
.spc-sens-label { color: ${textSec}; }
.spc-sens-val { font-weight: 600; font-variant-numeric: tabular-nums; }
.spc-sens-val.up { color: #10B981; }
.spc-sens-val.down { color: #EF4444; }

@media (max-width: 900px) {
  .spc-main { grid-template-columns: 1fr; padding: 16px; }
  .spc-main-mini { grid-template-columns: 1fr; }
}
`;
  }
}

customElements.define('store-profit-calculator', StoreProfitCalculator);
