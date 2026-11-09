'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {performDesktop} = require('./observation.cjs');
const {rememberAccounts} = require('./account-catalog.cjs');

class SessionMonitor {
  constructor(plan, dir, {perform = performDesktop, remember = rememberAccounts, now = Date.now} = {}) {
    this.plan = plan; this.dir = dir; this.perform = perform; this.remember = remember; this.now = now;
    this.target = plan.account; this.attempted = null; this.verifiedKey = null; this.verifiedAt = 0;
    this.observedKey = null; this.reauthCode = null;
    this.lastVerificationAttempt = -Infinity; this.remoteAttempted = false;
  }
  async poll(status) {
    const requestFile = path.join(this.dir, 'select-account.json');
    try {
      const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
      // Consume before dispatch: a lost reply must never cause an automatic repeat.
      fs.unlinkSync(requestFile);
      this.target = request.account; this.attempted = null; this.verifiedKey = null; this.reauthCode = null;
      this.remoteAttempted = false; this.lastVerificationAttempt = -Infinity;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let snapshot = await this.perform(this.plan, status, 'snapshot');
    const saved = this.remember(this.plan.catalogHome, this.plan, status.application, snapshot);
    let base = {login: {step: snapshot.step, authenticated: snapshot.authenticated},
      accountsRemembered: snapshot.accounts.length, accountCapture: saved.saved ? 'saved' : saved.reason,
      currentAccount: snapshot.authenticated ? snapshot.accounts.find(a => a.isCurrent) || null : null,
      selectedAccount: this.target ? {id:this.target.id,label:this.target.label,selector:this.target.selector} : null,
      sessionStorage: 'target-application-on-this-computer'};
    if(!saved.saved)return {...base,state:'checking-account',code:saved.reason,
      nextAction:'Account history has not been saved. Refresh the catalog or restore the original profile; application sessions remain intact.'};
    const current = () => snapshot.authenticated ? snapshot.accounts.find(a => a.isCurrent)?.accountKey : null;
    if(!snapshot.authenticated&&this.verifiedKey)this.reauthCode='ACCOUNT_REAUTH_REQUIRED';
    if (this.observedKey !== current()) {this.verifiedKey = null;this.lastVerificationAttempt = -Infinity;this.observedKey = current();}
    if(!snapshot.authenticated&&this.reauthCode==='ACCOUNT_REAUTH_REQUIRED')return {...base,state:'waiting-for-owner',code:this.reauthCode,verification:undefined,nextAction:'The previously verified local session is no longer authenticated. Reauthorize through normal Cindy sign-in on this computer; no automatic account switch is retried.'};
    if (this.target && current() !== this.target.selector) {
      this.verifiedKey = null;
      if (!snapshot.accounts.some(a => a.accountKey === this.target.selector))
        return {...base, state: 'waiting-for-owner', code: 'ACCOUNT_SIGN_IN_REQUIRED',
          nextAction: 'Sign in to the selected real account in this application on this computer. Other computers retain their own sessions.'};
      if (this.attempted === this.target.selector)
        return {...base, state: 'waiting-for-owner', code: this.reauthCode || 'ACCOUNT_SELECTION_UNCONFIRMED',
          nextAction: this.reauthCode?'The saved local session is unavailable. Reauthorize this account through normal Cindy sign-in on this computer; other computers keep their own sessions.':'Inspect the actual account/login state. Complete sign-in or explicitly select the account again after checking; no automatic switch retry.'};
      this.attempted = this.target.selector;
      const selection=await this.perform(this.plan, status, 'select', {accountKey: this.target.selector});
      if(selection.operationError){this.reauthCode=selection.operationError;return {...base,state:'waiting-for-owner',code:this.reauthCode,nextAction:'Reauthorize this account through normal Cindy sign-in on this computer. No stored credential is copied or switch automatically retried.'};}
      return {...base, state: 'checking-account', code: undefined, verification: undefined,
        nextAction: 'Account switch requested; the next observation must confirm identity and online authentication.'};
    }
    if (!current()) {
      this.verifiedKey = null;
      return {...base, state: 'waiting-for-owner', code: 'ACCOUNT_SIGN_IN_REQUIRED',
        nextAction: 'Use normal application sign-in. The persistent profile retains every app-saved account; no tokens are copied to the plugin.'};
    }
    this.reauthCode=null;
    if (!snapshot.databaseReady)
      return {...base, state: 'checking-account', code: snapshot.code || 'DATABASE_NOT_READY', nextAction: 'Wait for this account’s application database to be ready.'};
    const remote = this.plan.configuration.remoteControl;
    if (remote !== 'inherit' && snapshot.remoteControl !== (remote === 'on')) {
      if (this.remoteAttempted)
        return {...base, state: 'checking-account', code: 'REMOTE_CONTROL_UNCONFIRMED', nextAction: 'Inspect the application remote-control setting before explicitly requesting another account selection.'};
      this.remoteAttempted = true;
      await this.perform(this.plan, status, 'remote-control', {enabled: remote === 'on'});
      return {...base, state: 'checking-account', code: undefined, nextAction: 'Confirming the requested remote-control setting.'};
    }
    if ((!this.verifiedKey || this.now() - this.verifiedAt >= 60_000) && this.now() - this.lastVerificationAttempt >= 15_000) {
      this.lastVerificationAttempt = this.now();
      const before = current();
      snapshot = await this.perform(this.plan, status, 'verify');
      base={...base,login:{step:snapshot.step,authenticated:snapshot.authenticated},currentAccount:snapshot.authenticated?snapshot.accounts.find(a=>a.isCurrent)||null:null};
      if(!snapshot.authenticated){this.verifiedKey=null;return {...base,state:'waiting-for-owner',code:'ACCOUNT_REAUTH_REQUIRED',verification:undefined,nextAction:'The local session is no longer authenticated. Reauthorize through normal Cindy sign-in on this computer.'};}
      if (snapshot.verified && current() === before && snapshot.databaseReady) {
        this.verifiedKey = before; this.verifiedAt = this.now();
      } else this.verifiedKey = null;
    }
    if(remote!=='inherit'&&snapshot.remoteControl!==(remote==='on'))return {...base,state:'checking-account',code:'REMOTE_CONTROL_UNCONFIRMED',verification:undefined,nextAction:'The remote-control setting changed during online verification; wait for another observation.'};
    if (!this.verifiedKey || this.verifiedKey !== current() || this.now() - this.verifiedAt >= 60_000)
      return {...base, state: 'checking-account', code: 'ONLINE_VERIFICATION_PENDING', verification: undefined,
        nextAction: 'Online authentication is not confirmed. Check network or application sign-in; no acceptance success is implied.'};
    return {...base, state: 'ready', code: undefined, nextAction: 'Prepare samples and execute the saved cases using real application tools, then stop this job.',
      verification: 'application-account-online', accountVerifiedAt: this.verifiedAt,
      acceptance: {samples: 'not-verified', cases: 'not-executed'}};
  }
}

module.exports = {SessionMonitor};
