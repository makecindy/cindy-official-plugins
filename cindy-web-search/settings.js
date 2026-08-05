/**
 * Web Search 设置页脚本(CSP 禁内联,外挂加载)。
 * 数据面:主机 /secrets 只写通道(绝对路径,协议保留路径)——
 *   GET /secrets           → [{ key, saved, tail? }](只有状态 + 尾 4 位指纹,永远没有值)
 *   PUT /secrets/<key>     → { value } 单向入库(主机 OS 级加密保管)
 *   DELETE /secrets/<key>  → 清除
 * 三条凭证(Brave / Tavily / Search1API)同构:行结构与文案由 settings.html 的 data-* 驱动,
 * 本脚本按 .secret 容器统一接线。收单不存值:保存成功后清空输入框、点亮
 * 「已保存」;明文读不回来,想换 key 直接粘贴新值覆盖。
 */
(function () {
  'use strict';

  var statusTimer = null;
  function showStatus(text) {
    var el = document.getElementById('status');
    el.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ''; }, 2500);
  }

  /** 每行凭证的接线上下文(DOM 引用 + data-* 文案)。 */
  function wireRow(root) {
    var key = root.getAttribute('data-key');
    var tailPrefix = root.getAttribute('data-tail-prefix') || '…';
    var emptyPh = root.getAttribute('data-empty-ph') || '粘贴 key';
    var input = root.querySelector('.key-input');
    var eye = root.querySelector('.eye');
    var badge = root.querySelector('.badge');

    /**
     * saved = 是否已入库;tail = 主机截存的尾 4 位指纹(帮回忆填的是哪个 key)。
     * 指纹直接进输入框占位文案;值太短不产指纹时退回纯「已保存」文案。
     */
    function setSaved(saved, tail) {
      badge.className = saved ? 'badge on' : 'badge';
      input.placeholder = saved
        ? (tail ? tailPrefix + tail + ';粘贴新值可覆盖' : '已保存;粘贴新值可覆盖')
        : emptyPh;
    }

    /**
     * 眼睛只服务「正在输入的新值」的核对——已存的值永远读不回,空框时
     * 点它必然没反应,干脆藏掉;隐藏同时复位密文态,下次粘贴默认遮蔽。
     */
    function syncEye() {
      var empty = input.value.length === 0;
      eye.classList.toggle('hidden', empty);
      if (empty) {
        input.type = 'password';
        eye.classList.remove('revealed');
      }
    }

    eye.addEventListener('click', function () {
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      eye.classList.toggle('revealed', reveal);
    });
    input.addEventListener('input', syncEye);
    root.querySelector('.save').addEventListener('click', function () {
      var value = input.value.trim();
      if (!value) {
        showStatus('先粘贴 key 再保存');
        return;
      }
      fetch('/secrets/' + key, { method: 'PUT', body: JSON.stringify({ value: value }) })
        .then(function (r) {
          if (r.status === 204) {
            // 收单即焚:值已单向入库,页面不留明文;尾指纹从 /secrets 回查。
            input.value = '';
            syncEye();
            setSaved(true, null);
            void load();
            showStatus('凭证已保存');
          } else {
            showStatus('保存失败(' + r.status + '),请重试');
          }
        })
        .catch(function () { showStatus('保存失败,请重试'); });
    });
    root.querySelector('.clear').addEventListener('click', function () {
      fetch('/secrets/' + key, { method: 'DELETE' })
        .then(function (r) {
          if (r.status === 204) {
            input.value = '';
            syncEye();
            setSaved(false, null);
            showStatus('凭证已清除');
          } else {
            showStatus('清除失败(' + r.status + '),请重试');
          }
        })
        .catch(function () { showStatus('清除失败,请重试'); });
    });
    syncEye();
    return { key: key, setSaved: setSaved };
  }

  var rows = [];
  var nodes = document.querySelectorAll('.secret');
  for (var i = 0; i < nodes.length; i++) rows.push(wireRow(nodes[i]));

  async function load() {
    var list = null;
    try {
      var r = await fetch('/secrets');
      list = await r.json();
    } catch (e) {
      list = null;
    }
    for (var i = 0; i < rows.length; i++) {
      var entry = Array.isArray(list)
        ? list.filter(function (s) { return s && s.key === rows[i].key; })[0]
        : null;
      rows[i].setSaved(
        Boolean(entry && entry.saved),
        entry && typeof entry.tail === 'string' ? entry.tail : null,
      );
    }
  }

  void load();
})();
