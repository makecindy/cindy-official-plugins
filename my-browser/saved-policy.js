'use strict';
(function(root) {
  // Pre-0.3.2 saved policies did not distinguish built-in blocks from user entries.
  // Recognize only the complete old preset; partial/custom lists remain untouched.
  const LEGACY_BLOCK = ['mail.google.com', 'outlook.com', 'outlook.live.com', 'mail.qq.com', 'mail.163.com',
    '1password.com', 'lastpass.com', 'bitwarden.com', 'accounts.google.com', 'login.microsoftonline.com',
    'appleid.apple.com', 'paypal.com', 'stripe.com', 'alipay.com', 'cmbchina.com', 'icbc.com.cn',
    'bankofamerica.com', 'chase.com', 'coinbase.com', 'binance.com', 'console.aws.amazon.com',
    'console.cloud.google.com', 'portal.azure.com'];
  function savedPolicy(cfg, P) {
    const policy = cfg.policy ? P.normalizePolicy(cfg.policy) : P.defaults();
    if (!cfg.siteDefaultsVersion && LEGACY_BLOCK.every(host => policy.read.block.includes(host))) {
      policy.read.block = policy.read.block.filter(host => !LEGACY_BLOCK.includes(host));
    }
    return policy;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = savedPolicy;
  else root.myBrowserSavedPolicy = savedPolicy;
})(globalThis);
