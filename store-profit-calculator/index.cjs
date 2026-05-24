/**
 * 门店盈利计算器 - Node.js 后端用法
 * const { calcStoreProfit, diagnose } = require('./engine.cjs')
 */

const { calcStoreProfit: _calc, diagnose: _diagnose, presets: _presets, benchmarks: _benchmarks, formatMoney, formatMoneyFull, getVerdict } = require('./engine.cjs');

module.exports = {
  calcStoreProfit: _calc,
  diagnose: _diagnose,
  presets: _presets,
  benchmarks: _benchmarks,
  formatMoney,
  formatMoneyFull,
  getVerdict
};
