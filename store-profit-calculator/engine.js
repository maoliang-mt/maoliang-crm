/**
 * 门店盈利计算引擎 - 纯计算模块
 * 无 DOM 依赖，可在 Node.js / 浏览器 / 小程序 中使用
 *
 * 用法:
 *   import { calcStoreProfit, presets } from './engine.js'
 *   const result = calcStoreProfit({ area: 120, rent: 15000, ... })
 */

// ============================================================
// 行业预设数据
// ============================================================
export const presets = {
  fastfood: {
    name: '快餐小吃', area: 60, seatArea: 1.5, seatsPerTable: 4, turnover: 3.0, openDays: 30, takeoutPct: 35,
    avgTableSpend: 80, avgPerPerson: 22, takeoutAvgPrice: 25, rent: 8000,
    chefCount: 1, chefSalary: 6000, waiterCount: 2, waiterSalary: 3500, mgrCount: 1, mgrSalary: 7000,
    foodCostRate: 38, utilities: 2000, takeoutCommission: 18, otherCost: 1500
  },
  chinese: {
    name: '中餐正餐', area: 180, seatArea: 2.0, seatsPerTable: 6, turnover: 1.5, openDays: 30, takeoutPct: 10,
    avgTableSpend: 360, avgPerPerson: 65, takeoutAvgPrice: 55, rent: 25000,
    chefCount: 3, chefSalary: 8000, waiterCount: 6, waiterSalary: 4000, mgrCount: 1, mgrSalary: 10000,
    foodCostRate: 35, utilities: 5000, takeoutCommission: 18, otherCost: 3000
  },
  hotpot: {
    name: '火锅串串', area: 200, seatArea: 2.2, seatsPerTable: 4, turnover: 1.8, openDays: 30, takeoutPct: 8,
    avgTableSpend: 320, avgPerPerson: 85, takeoutAvgPrice: 60, rent: 28000,
    chefCount: 2, chefSalary: 7000, waiterCount: 8, waiterSalary: 4000, mgrCount: 1, mgrSalary: 10000,
    foodCostRate: 40, utilities: 6000, takeoutCommission: 18, otherCost: 3500
  },
  bbq: {
    name: '烧烤夜宵', area: 120, seatArea: 2.0, seatsPerTable: 4, turnover: 1.5, openDays: 30, takeoutPct: 15,
    avgTableSpend: 280, avgPerPerson: 75, takeoutAvgPrice: 55, rent: 15000,
    chefCount: 2, chefSalary: 7500, waiterCount: 4, waiterSalary: 4000, mgrCount: 1, mgrSalary: 9000,
    foodCostRate: 38, utilities: 4000, takeoutCommission: 18, otherCost: 2500
  },
  cafe: {
    name: '咖啡茶饮', area: 50, seatArea: 2.5, seatsPerTable: 2, turnover: 2.5, openDays: 30, takeoutPct: 40,
    avgTableSpend: 60, avgPerPerson: 32, takeoutAvgPrice: 28, rent: 12000,
    chefCount: 1, chefSalary: 5500, waiterCount: 2, waiterSalary: 3800, mgrCount: 1, mgrSalary: 8000,
    foodCostRate: 28, utilities: 2500, takeoutCommission: 20, otherCost: 2000
  }
};

// ============================================================
// 行业基准线（用于诊断）
// ============================================================
export const benchmarks = {
  profitRate:      { excellent: 20, good: 10, warning: 0 },
  rentRatio:       { danger: 20, warning: 15 },
  laborRatio:      { danger: 25, warning: 20 },
  foodCostRate:    { low: 25, mid: 35, high: 42 },
  takeoutPct:      { low: 10, mid: 25, high: 40 }
};

// ============================================================
// 诊断规则
// ============================================================
export function diagnose(result) {
  const issues = [];
  const strengths = [];

  if (result.profitRate >= 20)       strengths.push('利润率超过20%，经营健康');
  else if (result.profitRate >= 10)   strengths.push('利润率10-20%，经营良好');
  else if (result.profitRate >= 0)    issues.push({ level: 'warn', msg: '利润率低于10%，抗风险能力弱' });
  else                               issues.push({ level: 'critical', msg: '处于亏损状态，需立即调整' });

  if (result.rentRatio > 20)         issues.push({ level: 'critical', msg: '房租占比超20%，租金压力过大' });
  else if (result.rentRatio > 15)     issues.push({ level: 'warn', msg: '房租占比15-20%，偏高' });
  else if (result.rentRatio > 0)      strengths.push('房租占比健康');

  if (result.laborRatio > 25)         issues.push({ level: 'critical', msg: '人工占比超25%，人效偏低' });
  else if (result.laborRatio > 20)    issues.push({ level: 'warn', msg: '人工占比20-25%，偏高' });
  else if (result.laborRatio > 0)      strengths.push('人工占比健康');

  if (result.foodCostRatio > 42)      issues.push({ level: 'warn', msg: '食材成本率超42%，需优化供应链或定价' });
  else if (result.foodCostRatio > 0)   strengths.push('食材成本率可控');

  // 策略建议
  const strategies = [];
  if (result.profitRate < 10 && result.turnover < 1.5)
    strategies.push('翻台率偏低，建议做引流活动提升客流');
  if (result.profitRate < 10 && result.rentRatio > 20)
    strategies.push('房租压力大，建议做储值锁客+提客单，摊薄固定成本');
  if (result.profitRate < 10 && result.laborRatio > 25)
    strategies.push('人工成本高，建议优化排班或引入自助点单');
  if (result.takeoutRatio < 15 && result.profitRate < 15)
    strategies.push('外卖占比低，可拓展外卖渠道增加营收');
  if (result.profitRate >= 10)
    strategies.push('经营健康，可考虑储值锁客+会员运营提升复购');

  return { issues, strengths, strategies };
}

// ============================================================
// 核心计算函数
// ============================================================

/**
 * 计算门店盈利
 * @param {Object} input - 输入参数
 * @returns {Object} 完整计算结果
 *
 * 输入参数:
 *   area            - 门店面积(㎡)
 *   seatArea        - 每座面积(㎡/座), 默认1.8
 *   seatsPerTable   - 每桌座位数, 默认4
 *   turnover        - 翻台率(次/天)
 *   openDays        - 营业天数(天/月), 默认30
 *   takeoutPct      - 外卖占比(%), 默认20
 *   avgTableSpend   - 桌均消费(元)
 *   avgPerPerson    - 客单价(元)
 *   takeoutAvgPrice - 外卖客单价(元), 默认取avgPerPerson
 *   rent            - 月租金(元)
 *   chefCount       - 厨师人数
 *   chefSalary      - 厨师月工资(元)
 *   waiterCount     - 服务员人数
 *   waiterSalary    - 服务员月工资(元)
 *   mgrCount        - 管理层人数
 *   mgrSalary       - 管理层月工资(元)
 *   foodCostRate    - 食材成本率(%), 默认35
 *   utilities       - 水电能耗(元/月)
 *   takeoutCommission - 外卖平台抽成(%), 默认18
 *   otherCost       - 其他月度支出(元)
 */
export function calcStoreProfit(input = {}) {
  // 解构输入，设默认值
  const {
    area = 0,
    seatArea = 1.8,
    seatsPerTable = 4,
    turnover = 0,
    openDays = 30,
    takeoutPct = 0,
    avgTableSpend = 0,
    avgPerPerson = 0,
    takeoutAvgPrice,  // 默认取avgPerPerson
    rent = 0,
    chefCount = 0,
    chefSalary = 0,
    waiterCount = 0,
    waiterSalary = 0,
    mgrCount = 0,
    mgrSalary = 0,
    foodCostRate = 35,
    utilities = 0,
    takeoutCommission = 18,
    otherCost = 0
  } = input;

  const _takeoutAvgPrice = takeoutAvgPrice || avgPerPerson;

  // ========== 空间计算 ==========
  const totalSeats = seatArea > 0 ? Math.floor(area / seatArea) : 0;
  const totalTables = seatsPerTable > 0 ? Math.floor(totalSeats / seatsPerTable) : 0;

  // ========== 营收计算 ==========
  // 日堂食
  const dailyDineInCustomers = totalTables * turnover * seatsPerTable;
  const dailyDineInRevenue = totalTables * turnover * avgTableSpend;
  const monthlyDineInRevenue = dailyDineInRevenue * openDays;

  // 月外卖
  const takeoutRatio = takeoutPct / 100;
  const dineInRatio = 1 - takeoutRatio;
  let monthlyTakeoutCustomers = 0;
  let monthlyTakeoutRevenue = 0;
  let monthlyTakeoutRevenueRaw = 0;

  if (dineInRatio > 0 && avgPerPerson > 0) {
    const totalDailyCustomers = dailyDineInCustomers / dineInRatio;
    const dailyTakeoutCustomers = totalDailyCustomers * takeoutRatio;
    monthlyTakeoutCustomers = Math.round(dailyTakeoutCustomers * openDays);
    monthlyTakeoutRevenue = dailyTakeoutCustomers * _takeoutAvgPrice * openDays;
    monthlyTakeoutRevenueRaw = monthlyTakeoutRevenue; // 扣抽成前
  }

  // 月总营收
  const monthlyDineInCustomers = Math.round(dailyDineInCustomers * openDays);
  const totalMonthlyCustomers = monthlyDineInCustomers + monthlyTakeoutCustomers;
  const totalRevenue = monthlyDineInRevenue + monthlyTakeoutRevenue;

  // ========== 成本计算 ==========
  const chefTotal = chefCount * chefSalary;
  const waiterTotal = waiterCount * waiterSalary;
  const mgrTotal = mgrCount * mgrSalary;
  const laborCost = chefTotal + waiterTotal + mgrTotal;

  const foodCost = totalRevenue * (foodCostRate / 100);
  const takeoutPlatformFee = monthlyTakeoutRevenueRaw * (takeoutCommission / 100);
  const totalCost = rent + laborCost + foodCost + utilities + takeoutPlatformFee + otherCost;

  // ========== 利润计算 ==========
  const monthProfit = totalRevenue - totalCost;
  const profitRate = totalRevenue > 0 ? (monthProfit / totalRevenue * 100) : 0;
  const yearProfit = monthProfit * 12;

  // ========== 关键比率 ==========
  const rentRatio = totalRevenue > 0 ? (rent / totalRevenue * 100) : 0;
  const laborRatio = totalRevenue > 0 ? (laborCost / totalRevenue * 100) : 0;
  const foodCostRatio = totalRevenue > 0 ? (foodCost / totalRevenue * 100) : 0;
  const takeoutActualRatio = totalRevenue > 0 ? (monthlyTakeoutRevenue / totalRevenue * 100) : 0;

  // ========== 盈亏平衡 ==========
  const dailyCost = openDays > 0 ? totalCost / openDays : 0;
  const breakEvenTurnover = totalTables > 0 && avgTableSpend > 0
    ? dailyCost / (totalTables * avgTableSpend)
    : 0;
  const breakEvenDailyRevenue = dailyCost;

  // ========== 成本明细 ==========
  const costBreakdown = [
    { key: 'rent',          name: '房租',         amount: rent },
    { key: 'chef',          name: '厨师工资',     amount: chefTotal,  detail: `${chefCount}人 × ${chefSalary.toLocaleString()}元` },
    { key: 'waiter',        name: '服务员工资',   amount: waiterTotal, detail: `${waiterCount}人 × ${waiterSalary.toLocaleString()}元` },
    { key: 'manager',       name: '管理层工资',   amount: mgrTotal,   detail: `${mgrCount}人 × ${mgrSalary.toLocaleString()}元` },
    { key: 'food',          name: '食材成本',     amount: foodCost,   detail: `${foodCostRate}% 营收` },
    { key: 'utilities',     name: '水电能耗',     amount: utilities },
    { key: 'takeoutFee',    name: '外卖平台抽成', amount: takeoutPlatformFee, detail: `${takeoutCommission}% 外卖营收` },
    { key: 'other',         name: '其他支出',     amount: otherCost },
  ].map(item => ({
    ...item,
    pctOfRevenue: totalRevenue > 0 ? +(item.amount / totalRevenue * 100).toFixed(1) : 0
  }));

  // ========== 敏感性分析 ==========
  const sensitivity = [
    { factor: '客单价',     impact: totalRevenue * 0.1 * (1 - foodCostRate / 100) },
    { factor: '翻台率',     impact: totalRevenue * 0.1 * (1 - foodCostRate / 100) },
    { factor: '食材成本率', impact: -foodCost * 0.1 },
    { factor: '房租',       impact: -rent * 0.1 },
    { factor: '人工',       impact: -laborCost * 0.1 },
  ].map(item => ({
    ...item,
    impact: Math.round(item.impact),
    pctOfProfit: monthProfit !== 0
      ? +(item.impact / Math.abs(monthProfit) * 100).toFixed(0)
      : 0
  }));

  // ========== 方案工厂对接数据 ==========
  // 这些字段可直接喂给策略引擎
  const proposalData = {
    // 储值档位建议（基于客单价）
    storageTiers: avgPerPerson > 0 ? [
      { name: '体验档', amount: Math.round(avgPerPerson * 2 / 10) * 10, gift: Math.round(avgPerPerson * 0.3) },
      { name: '主推档', amount: Math.round(avgPerPerson * 4.5 / 100) * 100, gift: Math.round(avgPerPerson * 1.2) },
      { name: '尊享档', amount: Math.round(avgPerPerson * 8 / 100) * 100, gift: Math.round(avgPerPerson * 3) },
    ] : [],
    // 月储值目标
    monthlyStorageTarget: Math.round(totalRevenue * 0.15),
    // 盈亏平衡翻台率
    breakEvenTurnover: +breakEvenTurnover.toFixed(2),
    // 诊断标签
    diagnosisTags: [
      profitRate < 0 ? '亏损' : profitRate < 10 ? '微利' : '盈利',
      rentRatio > 20 ? '高租金' : '租金合理',
      laborRatio > 25 ? '高人工' : '人工合理',
      takeoutActualRatio > 30 ? '高外卖' : takeoutActualRatio < 10 ? '低外卖' : '外卖适中',
    ].filter(t => t)
  };

  // ========== 组装返回 ==========
  return {
    // 空间
    totalSeats, totalTables,
    // 客流
    dailyDineInCustomers, monthlyDineInCustomers,
    monthlyTakeoutCustomers, totalMonthlyCustomers,
    // 营收
    monthlyDineInRevenue, monthlyTakeoutRevenue, totalRevenue,
    takeoutActualRatio,
    // 成本
    laborCost, chefTotal, waiterTotal, mgrTotal,
    foodCost, takeoutPlatformFee,
    totalCost, costBreakdown,
    // 利润
    monthProfit, yearProfit, profitRate,
    // 关键比率
    rentRatio, laborRatio, foodCostRatio,
    // 盈亏平衡
    breakEvenDailyRevenue, breakEvenTurnover,
    // 敏感性
    sensitivity,
    // 方案工厂对接
    proposalData,
  };
}

// ============================================================
// 工具函数
// ============================================================

/** 格式化金额（万元/元自适应） */
export function formatMoney(n) {
  if (n === 0) return '0';
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

/** 格式化金额（完整元） */
export function formatMoneyFull(n) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

/** 盈亏判定 */
export function getVerdict(profitRate) {
  if (profitRate >= 20) return { level: 'excellent', label: '🎉 优秀', desc: '利润率超过20%，经营状态健康', css: 'good' };
  if (profitRate >= 10) return { level: 'good',      label: '👍 良好', desc: '利润率10%-20%，有优化空间',  css: 'good' };
  if (profitRate >= 0)  return { level: 'ok',        label: '⚠️ 一般', desc: '利润率低于10%，需关注成本',  css: 'ok' };
  return                       { level: 'bad',       label: '🚨 亏损', desc: '入不敷出，需立即调整',      css: 'bad' };
}
