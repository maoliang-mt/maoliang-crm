/**
 * 门店盈利计算引擎 v3 - 纯计算模块
 * 无 DOM 依赖，可在 Node.js / 浏览器 / 小程序 中使用
 *
 * v3 改动（合并 v1 + v2 优点）:
 *   - 桌型配置：使用具体桌数（双人桌/四人桌/多人桌/包厢），直觉更清晰
 *   - 外卖营收：使用「外卖占总营收比例」模式（更准确）
 *   - 人工模式：支持 'detail'（分项）和 'total'（直填总额）
 *   - 投资字段：6项（装修/设备/押金/加盟费/营销费/其他）
 *   - 投资回报：回本月数 + 年化ROI + 3年净收益
 */

// ============================================================
// 行业预设数据（v3：桌型卡片 + 6项投资 + 营收占比外卖）
// ============================================================
export const presets = {
  fastfood: {
    name: '快餐小吃',
    table2: 8, table4: 6, table6: 0, tableBox: 0,
    avgPrice: 28, turnover: 3.0, openDays: 30, takeoutRevenuePct: 35,
    rent: 8000,
    laborMode: 'detail',
    chefCount: 1, chefSalary: 6000, waiterCount: 2, waiterSalary: 3500, mgrCount: 1, mgrSalary: 7000,
    foodCostRate: 38, utilities: 2000, takeoutCommission: 18, otherCost: 1500,
    investDecor: 80000, investEquip: 30000, investDeposit: 20000,
    investFranchise: 0, investMarketing: 10000, investOther: 10000
  },
  chinese: {
    name: '中餐正餐',
    table2: 4, table4: 12, table6: 4, tableBox: 3,
    avgPrice: 70, turnover: 1.5, openDays: 30, takeoutRevenuePct: 0,
    rent: 25000,
    laborMode: 'detail',
    chefCount: 3, chefSalary: 8000, waiterCount: 6, waiterSalary: 4000, mgrCount: 1, mgrSalary: 10000,
    foodCostRate: 35, utilities: 5000, takeoutCommission: 18, otherCost: 3000,
    investDecor: 300000, investEquip: 100000, investDeposit: 60000,
    investFranchise: 0, investMarketing: 30000, investOther: 40000
  },
  hotpot: {
    name: '火锅串串',
    table2: 4, table4: 14, table6: 6, tableBox: 4,
    avgPrice: 85, turnover: 1.8, openDays: 30, takeoutRevenuePct: 0,
    rent: 28000,
    laborMode: 'detail',
    chefCount: 2, chefSalary: 7000, waiterCount: 8, waiterSalary: 4000, mgrCount: 1, mgrSalary: 10000,
    foodCostRate: 40, utilities: 6000, takeoutCommission: 18, otherCost: 3500,
    investDecor: 400000, investEquip: 150000, investDeposit: 70000,
    investFranchise: 0, investMarketing: 40000, investOther: 50000
  },
  bbq: {
    name: '烧烤夜宵',
    table2: 4, table4: 8, table6: 3, tableBox: 2,
    avgPrice: 75, turnover: 1.5, openDays: 30, takeoutRevenuePct: 0,
    rent: 15000,
    laborMode: 'detail',
    chefCount: 2, chefSalary: 7500, waiterCount: 4, waiterSalary: 4000, mgrCount: 1, mgrSalary: 9000,
    foodCostRate: 38, utilities: 4000, takeoutCommission: 18, otherCost: 2500,
    investDecor: 150000, investEquip: 60000, investDeposit: 40000,
    investFranchise: 0, investMarketing: 20000, investOther: 20000
  },
  cafe: {
    name: '咖啡茶饮',
    table2: 10, table4: 4, table6: 0, tableBox: 0,
    avgPrice: 32, turnover: 2.5, openDays: 30, takeoutRevenuePct: 40,
    rent: 12000,
    laborMode: 'detail',
    chefCount: 1, chefSalary: 5500, waiterCount: 2, waiterSalary: 3800, mgrCount: 1, mgrSalary: 8000,
    foodCostRate: 28, utilities: 2500, takeoutCommission: 20, otherCost: 2000,
    investDecor: 120000, investEquip: 50000, investDeposit: 30000,
    investFranchise: 50000, investMarketing: 15000, investOther: 15000
  }
};

// 桌型座位配置
export const TABLE_CONFIG = {
  table2:   { seats: 2,  name: '双人桌' },
  table4:   { seats: 4,  name: '四人桌' },
  table6:   { seats: 7,  name: '多人桌' },
  tableBox: { seats: 10, name: '包厢'   },
};

// 行业基准线
export const benchmarks = {
  profitRate:   { excellent: 20, good: 10, warning: 0 },
  rentRatio:    { danger: 20, warning: 15 },
  laborRatio:   { danger: 25, warning: 20 },
  paybackMonths: { fast: 6, good: 12, normal: 18, slow: 24, danger: 36 },
};

// ============================================================
// 诊断规则
// ============================================================
export function diagnose(result) {
  const issues = [];
  const strengths = [];
  const strategies = [];

  if (result.profitRate >= 20)     strengths.push('利润率超过20%，经营健康');
  else if (result.profitRate >= 10) strengths.push('利润率10-20%，经营良好');
  else if (result.profitRate >= 0)  issues.push({ level: 'warn', msg: '利润率低于10%，抗风险能力弱' });
  else                             issues.push({ level: 'critical', msg: '处于亏损状态，需立即调整' });

  if (result.rentRatio > 20)        issues.push({ level: 'critical', msg: '房租占比超20%，租金压力过大' });
  else if (result.rentRatio > 15)   issues.push({ level: 'warn', msg: '房租占比15-20%，偏高' });
  else if (result.rentRatio > 0)    strengths.push('房租占比健康');

  if (result.laborRatio > 25)       issues.push({ level: 'critical', msg: '人工占比超25%，人效偏低' });
  else if (result.laborRatio > 20)  issues.push({ level: 'warn', msg: '人工占比20-25%，偏高' });
  else if (result.laborRatio > 0)   strengths.push('人工占比健康');

  if (result.foodCostRatio > 42)    issues.push({ level: 'warn', msg: '食材成本率超42%，需优化供应链或定价' });
  else if (result.foodCostRatio > 0) strengths.push('食材成本率可控');

  if (result.paybackMonths !== undefined && result.paybackMonths !== null) {
    if (result.paybackMonths <= 12)       strengths.push(`${result.paybackMonths.toFixed(1)}个月回本，投资回收快`);
    else if (result.paybackMonths <= 24)  strategies.push('回本周期1-2年，考虑储值锁客加速资金回笼');
    else if (result.paybackMonths !== Infinity) strategies.push('回本偏慢，需重点提升翻台率或客单价');
  }

  if (result.profitRate >= 10) strategies.push('经营健康，可考虑储值锁客+会员运营提升复购');
  if (result.profitRate < 10 && result.rentRatio > 20)
    strategies.push('房租压力大，建议做储值锁客+提客单，摊薄固定成本');
  if (result.profitRate < 10 && result.laborRatio > 25)
    strategies.push('人工成本高，建议优化排班或引入自助点单');

  return { issues, strengths, strategies };
}

// ============================================================
// 核心计算函数（推算模式 - 桌型配置）
// ============================================================
/**
 * @param {Object} input
 *   桌型:  table2, table4, table6, tableBox（各桌型数量）
 *   经营:  avgPrice（客单价）, turnover（翻台/天）, openDays（营业天数）
 *          takeoutRevenuePct（外卖营收占总营收比例 %，0-95）
 *   人工:  laborMode('detail'|'total')
 *          detail: chefCount/chefSalary/waiterCount/waiterSalary/mgrCount/mgrSalary
 *          total:  totalLaborCost
 *   成本:  rent, foodCostRate(35), utilities, takeoutCommission(18), otherCost
 *   投资:  investDecor, investEquip, investDeposit, investFranchise, investMarketing, investOther
 */
export function calcStoreProfit(input = {}) {
  const {
    table2 = 0, table4 = 0, table6 = 0, tableBox = 0,
    avgPrice = 0, turnover = 0, openDays = 30,
    takeoutRevenuePct = 0,
    rent = 0,
    laborMode = 'detail',
    totalLaborCost = 0,
    chefCount = 0, chefSalary = 0,
    waiterCount = 0, waiterSalary = 0,
    mgrCount = 0, mgrSalary = 0,
    foodCostRate = 35, utilities = 0,
    takeoutCommission = 18, otherCost = 0,
    investDecor = 0, investEquip = 0, investDeposit = 0,
    investFranchise = 0, investMarketing = 0, investOther = 0,
  } = input;

  // ========== 空间 ==========
  const totalSeats = table2 * TABLE_CONFIG.table2.seats
    + table4 * TABLE_CONFIG.table4.seats
    + table6 * TABLE_CONFIG.table6.seats
    + tableBox * TABLE_CONFIG.tableBox.seats;
  const totalTables = table2 + table4 + table6 + tableBox;

  // ========== 营收 ==========
  // 堂食营收（从桌型推算）
  const dailyDineInCustomers = totalSeats * turnover;
  const monthlyDineInRevenue = dailyDineInCustomers * avgPrice * openDays;
  const monthlyDineInCustomers = Math.round(dailyDineInCustomers * openDays);

  // 外卖营收：外卖占总营收比例 → 反推
  // totalRevenue = dineIn / (1 - takeoutRatio)
  const takeoutRatio = Math.min(takeoutRevenuePct / 100, 0.95);
  let totalRevenue = 0;
  let monthlyTakeoutRevenue = 0;
  let monthlyTakeoutCustomers = 0;

  if (monthlyDineInRevenue > 0) {
    if (takeoutRatio > 0) {
      totalRevenue = monthlyDineInRevenue / (1 - takeoutRatio);
      monthlyTakeoutRevenue = totalRevenue * takeoutRatio;
      if (avgPrice > 0) {
        monthlyTakeoutCustomers = Math.round(monthlyTakeoutRevenue / avgPrice);
      }
    } else {
      totalRevenue = monthlyDineInRevenue;
    }
  }

  const totalMonthlyCustomers = monthlyDineInCustomers + monthlyTakeoutCustomers;
  const takeoutActualRatio = totalRevenue > 0 ? (monthlyTakeoutRevenue / totalRevenue * 100) : 0;

  // ========== 成本 ==========
  let chefTotal = 0, waiterTotal = 0, mgrTotal = 0, laborCost = 0;
  if (laborMode === 'total') {
    laborCost = totalLaborCost;
  } else {
    chefTotal = chefCount * chefSalary;
    waiterTotal = waiterCount * waiterSalary;
    mgrTotal = mgrCount * mgrSalary;
    laborCost = chefTotal + waiterTotal + mgrTotal;
  }

  const foodCost = totalRevenue * (foodCostRate / 100);
  const takeoutPlatformFee = monthlyTakeoutRevenue * (takeoutCommission / 100);
  const totalCost = rent + laborCost + foodCost + utilities + takeoutPlatformFee + otherCost;

  // ========== 利润 ==========
  const monthProfit = totalRevenue - totalCost;
  const profitRate = totalRevenue > 0 ? (monthProfit / totalRevenue * 100) : 0;
  const yearProfit = monthProfit * 12;

  const rentRatio    = totalRevenue > 0 ? (rent      / totalRevenue * 100) : 0;
  const laborRatio   = totalRevenue > 0 ? (laborCost / totalRevenue * 100) : 0;
  const foodCostRatio= totalRevenue > 0 ? (foodCost  / totalRevenue * 100) : 0;

  // ========== 投资回报（v2风格：6项投资 + ROI + 3年） ==========
  const totalInvest = investDecor + investEquip + investDeposit + investFranchise + investMarketing + investOther;
  const paybackMonths = (totalInvest > 0 && monthProfit > 0) ? +(totalInvest / monthProfit).toFixed(1) : (totalInvest > 0 ? Infinity : null);
  const paybackYears  = paybackMonths && paybackMonths !== Infinity ? paybackMonths / 12 : null;
  const yearROI       = totalInvest > 0 ? (yearProfit / totalInvest * 100) : 0;
  const totalReturn3Y = totalInvest > 0 ? (monthProfit * 36 - totalInvest) : null;

  const investBreakdown = [
    { key: 'decor',     name: '装修费用',     amount: investDecor     },
    { key: 'equip',     name: '设备采购',     amount: investEquip     },
    { key: 'deposit',   name: '押金/转让费',  amount: investDeposit   },
    { key: 'franchise', name: '加盟费/品牌费', amount: investFranchise },
    { key: 'marketing', name: '开业营销费',   amount: investMarketing },
    { key: 'other',     name: '其他前期投入', amount: investOther     },
  ].filter(i => i.amount > 0)
   .map(i => ({ ...i, pctOfInvest: +(i.amount / totalInvest * 100).toFixed(1) }));

  // ========== 成本明细 ==========
  const costBreakdown = (laborMode === 'total' ? [
    { key: 'rent',       name: '房租',       amount: rent },
    { key: 'labor',      name: '人工合计',   amount: laborCost,          detail: '（直接填写）' },
    { key: 'food',       name: '食材成本',   amount: foodCost,           detail: `${foodCostRate}% 营收` },
    { key: 'utilities',  name: '水电能耗',   amount: utilities },
    { key: 'takeoutFee', name: '外卖平台抽成', amount: takeoutPlatformFee, detail: `${takeoutCommission}% 外卖营收` },
    { key: 'other',      name: '其他支出',   amount: otherCost },
  ] : [
    { key: 'rent',       name: '房租',         amount: rent },
    { key: 'chef',       name: '厨师工资',     amount: chefTotal,   detail: `${chefCount}人 × ${chefSalary.toLocaleString()}元` },
    { key: 'waiter',     name: '服务员工资',   amount: waiterTotal, detail: `${waiterCount}人 × ${waiterSalary.toLocaleString()}元` },
    { key: 'manager',    name: '管理层工资',   amount: mgrTotal,    detail: `${mgrCount}人 × ${mgrSalary.toLocaleString()}元` },
    { key: 'food',       name: '食材成本',     amount: foodCost,    detail: `${foodCostRate}% 营收` },
    { key: 'utilities',  name: '水电能耗',     amount: utilities },
    { key: 'takeoutFee', name: '外卖平台抽成', amount: takeoutPlatformFee, detail: `${takeoutCommission}% 外卖营收` },
    { key: 'other',      name: '其他支出',     amount: otherCost },
  ]).map(item => ({ ...item, pctOfRevenue: totalRevenue > 0 ? +(item.amount / totalRevenue * 100).toFixed(1) : 0 }));

  // ========== 敏感性分析 ==========
  const sensitivity = [
    { factor: '营业额',     impact:  totalRevenue * 0.1 * (1 - foodCostRate / 100) },
    { factor: '食材成本率', impact: -foodCost * 0.1 },
    { factor: '房租',       impact: -rent * 0.1 },
    { factor: '人工',       impact: -laborCost * 0.1 },
  ].map(item => ({
    ...item,
    impact: Math.round(item.impact),
    pctOfProfit: monthProfit !== 0 ? +(item.impact / Math.abs(monthProfit) * 100).toFixed(0) : 0
  }));

  // ========== 方案工厂对接 ==========
  const proposalData = {
    monthlyStorageTarget: Math.round(totalRevenue * 0.15),
    diagnosisTags: [
      profitRate < 0 ? '亏损' : profitRate < 10 ? '微利' : '盈利',
      rentRatio  > 20 ? '高租金' : '租金合理',
      laborRatio > 25 ? '高人工' : '人工合理',
    ].filter(Boolean),
    paybackMonths,
    totalInvestment: totalInvest,
  };

  return {
    totalSeats, totalTables,
    monthlyDineInCustomers, monthlyTakeoutCustomers, totalMonthlyCustomers,
    monthlyDineInRevenue, monthlyTakeoutRevenue, totalRevenue,
    takeoutActualRatio,
    laborCost, chefTotal, waiterTotal, mgrTotal,
    foodCost, takeoutPlatformFee,
    totalCost, costBreakdown,
    monthProfit, yearProfit, profitRate,
    rentRatio, laborRatio, foodCostRatio,
    totalInvest, investBreakdown, paybackMonths, paybackYears, yearROI, totalReturn3Y,
    sensitivity, proposalData,
  };
}

// ============================================================
// 直填模式（知道月营业额直接填）
// ============================================================
export function calcStoreProfitDirect(input = {}) {
  const {
    dailyRevenue = 0, openDays = 30, takeoutRevenuePct = 0,
    rent = 0,
    laborMode = 'detail',
    totalLaborCost = 0,
    chefCount = 0, chefSalary = 0,
    waiterCount = 0, waiterSalary = 0,
    mgrCount = 0, mgrSalary = 0,
    foodCostRate = 35, utilities = 0,
    takeoutCommission = 18, otherCost = 0,
    investDecor = 0, investEquip = 0, investDeposit = 0,
    investFranchise = 0, investMarketing = 0, investOther = 0,
  } = input;

  const totalRevenue = dailyRevenue * openDays;
  const takeoutRatio = Math.min(takeoutRevenuePct / 100, 0.95);
  const monthlyDineInRevenue = totalRevenue * (1 - takeoutRatio);
  const monthlyTakeoutRevenue = totalRevenue * takeoutRatio;

  let chefTotal = 0, waiterTotal = 0, mgrTotal = 0, laborCost = 0;
  if (laborMode === 'total') {
    laborCost = totalLaborCost;
  } else {
    chefTotal = chefCount * chefSalary;
    waiterTotal = waiterCount * waiterSalary;
    mgrTotal = mgrCount * mgrSalary;
    laborCost = chefTotal + waiterTotal + mgrTotal;
  }

  const foodCost = totalRevenue * (foodCostRate / 100);
  const takeoutPlatformFee = monthlyTakeoutRevenue * (takeoutCommission / 100);
  const totalCost = rent + laborCost + foodCost + utilities + takeoutPlatformFee + otherCost;

  const monthProfit = totalRevenue - totalCost;
  const profitRate  = totalRevenue > 0 ? (monthProfit / totalRevenue * 100) : 0;
  const yearProfit  = monthProfit * 12;
  const rentRatio   = totalRevenue > 0 ? (rent      / totalRevenue * 100) : 0;
  const laborRatio  = totalRevenue > 0 ? (laborCost / totalRevenue * 100) : 0;
  const foodCostRatio = totalRevenue > 0 ? (foodCost / totalRevenue * 100) : 0;

  const totalInvest   = investDecor + investEquip + investDeposit + investFranchise + investMarketing + investOther;
  const paybackMonths = (totalInvest > 0 && monthProfit > 0) ? +(totalInvest / monthProfit).toFixed(1) : (totalInvest > 0 ? Infinity : null);
  const yearROI       = totalInvest > 0 ? (yearProfit / totalInvest * 100) : 0;
  const totalReturn3Y = totalInvest > 0 ? (monthProfit * 36 - totalInvest) : null;

  return {
    totalRevenue, monthlyDineInRevenue, monthlyTakeoutRevenue,
    laborCost, chefTotal, waiterTotal, mgrTotal,
    foodCost, takeoutPlatformFee, totalCost,
    monthProfit, yearProfit, profitRate,
    rentRatio, laborRatio, foodCostRatio,
    totalInvest, paybackMonths, yearROI, totalReturn3Y,
    dailyRevenue,
    proposalData: {
      monthlyStorageTarget: Math.round(totalRevenue * 0.15),
      diagnosisTags: [
        profitRate < 0 ? '亏损' : profitRate < 10 ? '微利' : '盈利',
        rentRatio > 20 ? '高租金' : '租金合理',
        laborRatio > 25 ? '高人工' : '人工合理',
      ].filter(Boolean),
      paybackMonths,
      totalInvestment: totalInvest,
    },
  };
}

// ============================================================
// 工具函数
// ============================================================
export function formatMoney(n) {
  if (n === 0) return '0';
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

export function formatMoneyFull(n) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

export function getVerdict(profitRate) {
  if (profitRate >= 20) return { level: 'excellent', label: '🎉 优秀', desc: '利润率超过20%，经营状态健康', css: 'good' };
  if (profitRate >= 10) return { level: 'good',      label: '👍 良好', desc: '利润率10%-20%，有优化空间',  css: 'good' };
  if (profitRate >= 0)  return { level: 'ok',        label: '⚠️ 一般', desc: '利润率低于10%，需关注成本',  css: 'ok' };
  return                       { level: 'bad',       label: '🚨 亏损', desc: '入不敷出，需立即调整',      css: 'bad' };
}

export function getPaybackVerdict(months) {
  if (months === null)      return { label: '—', css: '' };
  if (months === Infinity)  return { label: '🚨 持续亏损，无法回本', css: 'bad' };
  if (months <= 6)          return { label: '⚡ 极速回本', css: 'good' };
  if (months <= 12)         return { label: '✅ 回本较快', css: 'good' };
  if (months <= 18)         return { label: '👍 正常水平', css: 'highlight' };
  if (months <= 24)         return { label: '⚠️ 回本偏慢', css: 'warn' };
  if (months <= 36)         return { label: '⚠️ 回本较慢', css: 'warn' };
  return                           { label: '🚨 回本困难', css: 'bad' };
}
