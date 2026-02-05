// ==UserScript==
// @name         Twitter Railgun Purge (Refined)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  性能优化版：支持正则、可拖拽按钮、低资源占用
// @author       Sakurairinaqwq
// @match        https://twitter.com/*
// @match        https://x.com/*
// @icon         https://i.imgur.com/7J6f2n4.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置常量 ---
    const CONFIG = {
        defaultRemote: 'https://raw.githubusercontent.com/Sakurairinaqwq/Twitter-Railgun/main/BlockTwitter.json',
        theme: {
            primary: '#FF4500', // 审判红
            core: '#FFFFFF',
            accent: '#FFD700',  // 警告黄
            consoleBg: '#0a0a0a',
            glass: 'backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);'
        },
        timing: { tossUp: 600, reload: 800 },
        selectors: {
            tweet: 'article[data-testid="tweet"]',
            userLink: 'a[href*="/status/"]'
        }
    };

    // --- 状态管理 ---
    const STATE = {
        processedNodes: new WeakSet(), // 内存优化：使用 WeakSet 防止内存泄漏
        blockList: GM_getValue('railgun_keywords', []),
        userBlockList: new Set(GM_getValue('railgun_users', [])), // 使用 Set 提高查找速度
        remoteUrl: GM_getValue('railgun_remote_url', CONFIG.defaultRemote),
        totalPurged: GM_getValue('railgun_total_purged', 0),
        autoBanBots: GM_getValue('railgun_auto_ban', false),
        isDevMode: GM_getValue('railgun_dev_mode', false),
        apiConfig: GM_getValue('railgun_api_config', null),
        isAnimating: false
    };

    // --- 样式注入 (保持原汁原味，增加了拖拽光标) ---
    const css = `
        /* 基础动画保持不变... */
        @keyframes coin-toss-up { 0% { transform: translateY(0) rotateY(0) scale(1); } 50% { transform: translateY(-200px) rotateY(900deg) scale(1.4); box-shadow: 0 0 50px ${CONFIG.theme.primary}; } 100% { transform: translateY(-180px) rotateY(1800deg) scale(1.4); opacity: 1; } }
        @keyframes hyper-beam-core { 0% { transform: scaleX(0); opacity: 0.8; } 10% { transform: scaleX(1); opacity: 1; height: 20px; background: ${CONFIG.theme.core}; box-shadow: 0 0 60px ${CONFIG.theme.primary}, 0 0 120px ${CONFIG.theme.primary}; } 100% { transform: scaleX(2); opacity: 0; height: 2px; } }
        @keyframes coin-reload-drop { 0% { transform: translateY(-300px); opacity: 0; } 70% { transform: translateY(10px); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }

        #railgun-coin { position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; background: radial-gradient(circle at 30% 30%, #fff, #d0d0d0 40%, #222); border: 3px solid ${CONFIG.theme.primary}; border-radius: 50%; box-shadow: 0 0 20px rgba(255, 69, 0, 0.4); display: flex; align-items: center; justify-content: center; cursor: grab; z-index: 9999; transition: transform 0.1s, box-shadow 0.2s; will-change: transform; user-select: none; touch-action: none; }
        #railgun-coin:active { cursor: grabbing; }
        #railgun-coin::after { content: '⚡'; font-size: 32px; background: linear-gradient(#fff, ${CONFIG.theme.accent}); -webkit-background-clip: text; color: transparent; font-weight: 900; filter: drop-shadow(0 0 5px ${CONFIG.theme.primary}); pointer-events: none; }
        #railgun-coin:hover { transform: scale(1.1); box-shadow: 0 0 40px ${CONFIG.theme.primary}; }
        #railgun-coin.tossing { animation: coin-toss-up ${CONFIG.timing.tossUp}ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards; pointer-events: none; }
        #railgun-coin.impacted { opacity: 0 !important; transition: none; pointer-events: none; }
        #railgun-coin.reloading { animation: coin-reload-drop ${CONFIG.timing.reload}ms cubic-bezier(0.19, 1, 0.22, 1) forwards; pointer-events: none; }

        /* VFX & Panel 样式 */
        #railgun-vfx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 99999; display: none; overflow: hidden; }
        .vfx-flash { position: absolute; inset: 0; background: white; opacity: 0; mix-blend-mode: screen; }
        .vfx-beam { position: absolute; top: 50%; left: 0; width: 200vw; height: 14px; background: white; transform-origin: left center; opacity: 0; pointer-events: none;}
        body.railgun-firing .vfx-flash { animation: screen-flash-impact 0.4s ease-out forwards; }
        body.railgun-firing .vfx-beam { animation: hyper-beam-core 0.5s cubic-bezier(0,0.9,0.2,1) forwards; }
        @keyframes screen-flash-impact { 0% { opacity: 0; } 5% { opacity: 0.9; background: ${CONFIG.theme.primary}; } 100% { opacity: 0; } }

        #railgun-panel {
            position: fixed; bottom: 30px; right: 30px; width: 380px;
            background: rgba(15, 15, 15, 0.95); ${CONFIG.theme.glass}
            border: 1px solid #333; border-left: 4px solid ${CONFIG.theme.primary};
            border-radius: 6px; padding: 20px;
            box-shadow: 0 30px 80px rgba(0,0,0,0.8); z-index: 99998;
            font-family: "Consolas", "Monaco", monospace; color: #fff;
            display: flex; flex-direction: column; gap: 12px;
            transform-origin: bottom right; opacity: 0; transform: scale(0); pointer-events: none;
            transition: transform 0.4s cubic-bezier(0.5, 0, 0, 1), opacity 0.3s ease-in;
        }
        #railgun-panel.active { opacity: 1; transform: scale(1); pointer-events: auto; }

        /* 通用 UI 组件 */
        .rg-header { display: flex; justify-content: flex-start; align-items: center; gap: 10px; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 5px; }
        .rg-title { font-size: 16px; color: ${CONFIG.theme.primary}; font-weight: 900; letter-spacing: 1px; }
        .rg-ver { font-size: 10px; background: #333; padding: 2px 6px; border-radius: 4px; color: #aaa; }
        .rg-label { font-size: 10px; color: #888; margin-bottom: 4px; display: block; text-transform: uppercase; }
        .rg-input { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #000; font-size: 11px; color: #00ff00; outline: none; box-sizing: border-box; }
        .rg-input:focus { border-color: ${CONFIG.theme.primary}; }
        .rg-switch-row { display: flex; align-items: center; justify-content: space-between; background: #222; padding: 8px; border-radius: 4px; border: 1px solid #333; }
        .rg-switch-label { font-size: 11px; color: #ccc; font-weight: bold; }
        .rg-switch { position: relative; display: inline-block; width: 36px; height: 18px; }
        .rg-switch input { opacity: 0; width: 0; height: 0; }
        .rg-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .4s; border-radius: 34px; }
        .rg-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .rg-slider { background-color: ${CONFIG.theme.primary}; }
        input:checked + .rg-slider:before { transform: translateX(18px); }
        .rg-danger-text { font-size: 9px; color: #ff4444; margin-top: 4px; display: flex; align-items: start; gap: 4px; line-height: 1.2; padding: 0 4px; }
        .rg-danger-text::before { content: '⚠️'; }

        #rg-console { background: ${CONFIG.theme.consoleBg}; border: 1px solid #333; border-radius: 4px; height: 100px; overflow-y: auto; padding: 8px; font-size: 10px; line-height: 1.4; color: #bbb; scrollbar-width: thin; scrollbar-color: #444 #111; }
        .log-entry { margin-bottom: 2px; border-bottom: 1px solid #1a1a1a; padding-bottom: 2px; }
        .log-time { color: #666; margin-right: 5px; }
        .log-type-info { color: #00BFFF; }
        .log-type-warn { color: ${CONFIG.theme.accent}; }
        .log-type-kill { color: ${CONFIG.theme.primary}; font-weight: bold; }
        .log-type-sys { color: #00ff00; }
        .rg-btn { background: #333; color: #fff; border: none; padding: 10px; border-radius: 4px; width: 100%; font-weight: bold; font-size: 12px; cursor: pointer; transition: all 0.2s; margin-top: 10px; }
        .rg-btn:hover { background: ${CONFIG.theme.primary}; }

        .rg-close { position: absolute; top: 15px; right: 15px; width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #888; font-size: 18px; transition: all 0.3s; z-index: 10; }
        .rg-close:hover { color: #fff; background: rgba(255, 69, 0, 0.8); border-color: #ff4500; transform: rotate(90deg) scale(1.1); box-shadow: 0 0 10px #ff4500; }

        .railgun-purged { display: none !important; }
        .railgun-dev-marked { position: relative; border: 2px dashed #ff0000 !important; background: rgba(255, 0, 0, 0.05) !important; box-sizing: border-box; }
        .railgun-dev-marked::before { content: '[RAILGUN BLOCK]'; position: absolute; top: 0; right: 0; background: #ff0000; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 6px; z-index: 10; }

        /* 模态框 */
        .rg-modal-overlay { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
        .rg-modal-overlay.visible { opacity: 1; pointer-events: auto; }
        .rg-modal { width: 320px; background: #111; border: 1px solid #ff4444; border-left: 6px solid #ff4444; padding: 24px; border-radius: 8px; box-shadow: 0 0 50px rgba(255, 0, 0, 0.3); font-family: sans-serif; transform: scale(0.9); transition: transform 0.3s; }
        .rg-modal-overlay.visible .rg-modal { transform: scale(1); }
        .rg-modal h3 { margin: 0 0 15px 0; color: #ff4444; font-size: 16px; font-weight: 900; display: flex; align-items: center; gap: 8px; }
        .rg-modal p { font-size: 12px; color: #ccc; line-height: 1.6; margin-bottom: 20px; }
        .rg-modal-actions { display: flex; gap: 10px; }
        .rg-modal-btn { flex: 1; padding: 10px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; border: none; }
        .rg-btn-danger { background: #ff4444; color: #000; }
        .rg-btn-cancel { background: #333; color: #fff; }
    `;
    GM_addStyle(css);

    // --- 日志系统 ---
    function logToConsole(msg, type = 'info') {
        const consoleEl = document.getElementById('rg-console');
        if (!consoleEl) return;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-type-${type}">[${type.toUpperCase()}]</span> ${msg}`;
        consoleEl.appendChild(entry);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    // --- 核心网络嗅探 (升级版) ---
    function startSniffer() {
        // 1. 拦截 XHR
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            checkUrl(url);
            originalOpen.apply(this, arguments);
        };

        // 2. 拦截 Fetch (Twitter 越来越多使用 Fetch)
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            checkUrl(url);
            return originalFetch.apply(this, args);
        };

        function checkUrl(url) {
            if (url && typeof url === 'string' && url.includes('/Retweeters') && url.includes('graphql')) {
                try {
                    const urlObj = new URL(url, window.location.origin);
                    const features = urlObj.searchParams.get('features');
                    const queryId = urlObj.pathname.split('/').slice(-2, -1)[0]; // 获取 ID
                    if (queryId && features && (!STATE.apiConfig || STATE.apiConfig.queryId !== queryId)) {
                        STATE.apiConfig = { baseUrl: urlObj.origin + urlObj.pathname, queryId, features };
                        GM_setValue('railgun_api_config', STATE.apiConfig);
                        logToConsole(`API 协议更新: ${queryId.substring(0,8)}...`, 'sys');
                    }
                } catch (e) {}
            }
        }
    }

    // --- 自动屏蔽逻辑 ---
    function launchDroneStrike(tweetId) {
        if (!STATE.apiConfig || !STATE.autoBanBots) return;

        logToConsole(`[轨道打击] 扫描转推 ID: ${tweetId}...`, 'info');
        const variables = JSON.stringify({ "tweetId": tweetId, "count": 40, "includePromotedContent": true });
        const targetUrl = `${STATE.apiConfig.baseUrl}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(STATE.apiConfig.features)}`;

        GM_xmlhttpRequest({
            method: "GET", url: targetUrl,
            headers: {
                "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "x-twitter-active-user": "yes",
                "x-csrf-token": getCookie("ct0") || "",
                "content-type": "application/json"
            },
            onload: function(response) {
                if (response.status === 200) {
                    try { processDroneData(JSON.parse(response.responseText)); }
                    catch (e) { logToConsole('数据解析错误', 'warn'); }
                } else {
                    logToConsole(`打击失败 HTTP ${response.status}`, 'warn');
                }
            },
            onerror: () => logToConsole('网络请求失败', 'warn')
        });
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function processDroneData(data) {
        let targets = [];
        try {
            // 深度遍历 JSON 结构 (增加容错)
            const instructions = data?.data?.retweeters_timeline?.timeline?.instructions || [];
            instructions.forEach(ins => {
                if (ins.type === 'TimelineAddEntries') {
                    ins.entries.forEach(entry => {
                        const legacy = entry.content?.itemContent?.user_results?.result?.legacy;
                        if (legacy && legacy.screen_name) targets.push(legacy.screen_name.toLowerCase());
                    });
                }
            });
        } catch (e) { console.error(e); }

        if (targets.length > 0) {
            let newKills = 0;
            targets.forEach(user => {
                if (!STATE.userBlockList.has(user)) {
                    STATE.userBlockList.add(user);
                    newKills++;
                }
            });
            if (newKills > 0) {
                // 将 Set 转回 Array 存储
                GM_setValue('railgun_users', Array.from(STATE.userBlockList));
                logToConsole(`>>> 处刑完毕: ${newKills} 个账号已加入黑名单`, 'kill');
                // 立即重新扫描页面以应用新的屏蔽
                forceRescan();
            } else {
                logToConsole(`目标已全部在黑名单中`, 'info');
            }
        }
    }

    // --- 拖拽功能 ---
    function makeDraggable(el) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        let isDragging = false;
        let startTime = 0;

        el.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e || window.event;
            // 排除右键
            if (e.button !== 0) return;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            startTime = new Date().getTime();
            isDragging = false;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            // 计算移动量
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            // 如果移动超过一定阈值，视为拖拽
            if (Math.abs(pos1) > 1 || Math.abs(pos2) > 1) isDragging = true;

            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
            el.style.bottom = 'auto'; // 清除默认定位
            el.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            // 如果是点击而不是拖拽，且时间短，则触发点击事件
            if (!isDragging && (new Date().getTime() - startTime) < 200) {
                if (typeof el.clickAction === 'function') el.clickAction();
            }
        }
    }

    // --- UI 构建 ---
    function createUI() {
        const panel = document.createElement('div');
        panel.id = 'railgun-panel';
        panel.innerHTML = `
            <div class="rg-close" title="关闭面板">×</div>
            <div class="rg-header">
                <div class="rg-title">RAILGUN <span style="color:#fff">//</span> SYSTEM</div>
                <span class="rg-ver">Ver 2.0.0</span>
            </div>
            <div id="rg-console">
                <div class="log-entry"><span class="log-time">[SYS]</span><span class="log-type-sys">[INIT]</span> 系统就绪 (Optimized Core)。</div>
            </div>
            <div class="rg-switch-row" style="margin-bottom: 5px;">
                <span class="rg-switch-label">开发者模式 (高亮不隐藏)</span>
                <label class="rg-switch"><input type="checkbox" id="rg-dev-switch" ${STATE.isDevMode ? 'checked' : ''}><span class="rg-slider"></span></label>
            </div>
            <div class="rg-switch-row">
                <span class="rg-switch-label">自动处刑 Bot (本地屏蔽)</span>
                <label class="rg-switch"><input type="checkbox" id="rg-autoban-switch" ${STATE.autoBanBots ? 'checked' : ''}><span class="rg-slider"></span></label>
            </div>
            <div class="rg-danger-text">警告：自动处刑会扫描转推者并加入本地黑名单。</div>
            <div style="margin-top:10px;">
                <label class="rg-label">云端规则库</label>
                <input type="text" id="rg-remote-url" class="rg-input" value="${STATE.remoteUrl}">
            </div>
            <div style="margin-top:5px;">
                <label class="rg-label">本地关键词 (支持正则, 用逗号分隔)</label>
                <input type="text" id="rg-local-keywords" class="rg-input" value="${STATE.blockList.join(', ')}">
            </div>
            <button id="rg-sync-btn" class="rg-btn">同步云端 & 应用配置</button>
            <div style="margin-top:8px; font-size:10px; color:#666; text-align:center;">已净化: <span id="rg-count">${STATE.totalPurged}</span></div>
        `;
        document.body.appendChild(panel);

        // 警告弹窗
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'rg-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="rg-modal">
                <h3>高危操作警告</h3>
                <p>开启 <strong>自动处刑 (Auto-Ban)</strong> 会自动请求推特 API 获取转推者名单，并将其加入<strong>本地黑名单</strong>。<br><br>虽然不会实际调用 Twitter 的拉黑接口（降低了风险），但频繁请求仍可能触发流控。</p>
                <div class="rg-modal-actions">
                    <button id="rg-modal-confirm" class="rg-modal-btn rg-btn-danger">确认开启</button>
                    <button id="rg-modal-cancel" class="rg-modal-btn rg-btn-cancel">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const vfxLayer = document.createElement('div');
        vfxLayer.id = 'railgun-vfx-layer';
        vfxLayer.innerHTML = `<div class="vfx-flash"></div><div class="vfx-beam"></div>`;
        document.body.appendChild(vfxLayer);

        const coin = document.createElement('div');
        coin.id = 'railgun-coin';
        coin.title = "拖拽移动 | 点击打开终端";
        document.body.appendChild(coin);

        // 绑定拖拽与点击
        makeDraggable(coin);
        coin.clickAction = () => {
            if (STATE.isAnimating) return;
            STATE.isAnimating = true;
            coin.classList.remove('reloading');
            coin.classList.add('tossing');

            // 设定特效位置为硬币当前位置
            const rect = coin.getBoundingClientRect();
            vfxLayer.querySelector('.vfx-beam').style.top = (rect.top + 30) + 'px';

            setTimeout(() => {
                vfxLayer.style.display = 'block';
                // 强制重绘
                vfxLayer.offsetHeight;
                document.body.classList.add('railgun-firing');
                coin.classList.add('impacted');
                panel.classList.add('active');
                if(STATE.apiConfig) logToConsole('API 连接: 正常', 'sys');
                else logToConsole('API 未捕获: 请点击任意推文的转推列表', 'warn');
            }, CONFIG.timing.tossUp);

            setTimeout(() => {
                document.body.classList.remove('railgun-firing');
                vfxLayer.style.display = 'none';
            }, CONFIG.timing.tossUp + 400);
        };

        // 关闭面板
        panel.querySelector('.rg-close').onclick = () => {
            panel.classList.remove('active');
            setTimeout(() => {
                coin.classList.remove('tossing', 'impacted');
                void coin.offsetWidth;
                coin.classList.add('reloading');
                setTimeout(() => { coin.classList.remove('reloading'); STATE.isAnimating = false; }, CONFIG.timing.reload);
            }, 400);
        };

        // 事件监听
        const autobanSwitch = document.getElementById('rg-autoban-switch');
        autobanSwitch.onclick = (e) => {
            if (autobanSwitch.checked) {
                e.preventDefault();
                modalOverlay.classList.add('visible');
            } else {
                STATE.autoBanBots = false;
                GM_setValue('railgun_auto_ban', false);
                logToConsole(`自动处刑: 已关闭`, 'sys');
            }
        };

        document.getElementById('rg-modal-confirm').onclick = () => {
            modalOverlay.classList.remove('visible');
            autobanSwitch.checked = true;
            STATE.autoBanBots = true;
            GM_setValue('railgun_auto_ban', true);
            logToConsole(`[DANGER] 自动处刑已开启`, 'warn');
        };

        document.getElementById('rg-modal-cancel').onclick = () => {
            modalOverlay.classList.remove('visible');
            autobanSwitch.checked = false;
        };

        document.getElementById('rg-dev-switch').onchange = (e) => {
            STATE.isDevMode = e.target.checked;
            GM_setValue('railgun_dev_mode', STATE.isDevMode);
            logToConsole(`开发者模式: ${STATE.isDevMode ? 'ON' : 'OFF'}`, 'sys');
            // 清除旧的标记以便重新渲染
            document.querySelectorAll('.railgun-dev-marked').forEach(el => {
                el.classList.remove('railgun-dev-marked');
                STATE.processedNodes.delete(el); // 从缓存中移除
            });
            forceRescan();
        };

        document.getElementById('rg-sync-btn').onclick = () => {
            const url = document.getElementById('rg-remote-url').value;
            const locals = document.getElementById('rg-local-keywords').value.split(/,|，/).map(s => s.trim()).filter(s => s);
            GM_setValue('railgun_remote_url', url);
            GM_setValue('railgun_keywords', locals);

            logToConsole('正在同步配置...', 'info');
            GM_xmlhttpRequest({
                method: "GET", url: url + '?t=' + Date.now(),
                onload: (res) => {
                    try {
                        let json = res.responseText.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
                        let data = JSON.parse(json);

                        STATE.blockList = [...new Set([...locals, ...(data.keywords||[])])];
                        // 合并 Set
                        const remoteUsers = data.users || [];
                        remoteUsers.forEach(u => STATE.userBlockList.add(u.toLowerCase()));

                        GM_setValue('railgun_keywords', STATE.blockList);
                        GM_setValue('railgun_users', Array.from(STATE.userBlockList));

                        logToConsole(`同步成功: ${STATE.blockList.length} 关键词, ${STATE.userBlockList.size} 用户`, 'sys');
                        forceRescan();
                    } catch(e) { logToConsole('同步失败: JSON 解析错误', 'warn'); }
                }
            });
        };
    }

    // --- 扫描与净化 (核心逻辑) ---
    function fireRailgun(element, reason) {
        // Dev模式只是标记，不隐藏
        if (STATE.isDevMode) {
            element.classList.add('railgun-dev-marked');
            element.title = `Railgun拦截: ${reason}`;
        } else {
            element.style.display = 'none';
        }

        STATE.totalPurged++;
        if (STATE.totalPurged % 10 === 0) {
             GM_setValue('railgun_total_purged', STATE.totalPurged);
             const countEl = document.getElementById('rg-count');
             if(countEl) countEl.innerText = STATE.totalPurged;
        }

        if (STATE.autoBanBots && !element.hasAttribute('data-drone-scanned')) {
            element.setAttribute('data-drone-scanned', 'true');
            const link = element.querySelector('a[href*="/status/"]');
            if (link) {
                const match = link.href.match(/\/status\/(\d+)/);
                if (match) {
                    // 随机延迟防止并发过高
                    setTimeout(() => launchDroneStrike(match[1]), Math.random() * 3000 + 2000);
                }
            }
        }
    }

    function checkKeyword(text) {
        for (const kw of STATE.blockList) {
            // 处理正则情况
            if (kw.startsWith('/') && kw.endsWith('/')) {
                try {
                    const pattern = kw.slice(1, -1);
                    if (new RegExp(pattern, 'i').test(text)) return kw;
                } catch(e) { /* 无效正则忽略 */ }
            } else {
                if (text.includes(kw.toLowerCase())) return kw;
            }
        }
        return null;
    }

    function processTweet(tweetNode) {
        if (STATE.processedNodes.has(tweetNode)) return;
        STATE.processedNodes.add(tweetNode);

        // 1. 文本检测 (使用 textContent 性能更好)
        const text = tweetNode.textContent.toLowerCase();
        const hitKw = checkKeyword(text);
        if (hitKw) {
            fireRailgun(tweetNode, `Key:${hitKw}`);
            return;
        }

        // 2. 用户名检测
        const userLinks = tweetNode.querySelectorAll('a[href^="/"]');
        for(let link of userLinks) {
            const u = link.getAttribute('href').replace('/','').toLowerCase();
            if(STATE.userBlockList.has(u)) {
                fireRailgun(tweetNode, `User:${u}`);
                return;
            }
        }
    }

    // 强力重扫 (用于配置更新后)
    function forceRescan() {
        const tweets = document.querySelectorAll(CONFIG.selectors.tweet);
        STATE.processedNodes = new WeakSet(); // 清空缓存
        tweets.forEach(processTweet);
    }

    // --- 初始化 ---
    function init() {
        console.log('Railgun System 2.0 (Refined) Online');
        startSniffer();
        createUI();

        // 高性能 Observer
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                // 仅处理新增节点
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1) {
                        // 如果是推文直接处理
                        if (node.matches && node.matches(CONFIG.selectors.tweet)) {
                            processTweet(node);
                        }
                        // 如果是容器，查找内部推文
                        else if (node.querySelectorAll) {
                            const tweets = node.querySelectorAll(CONFIG.selectors.tweet);
                            tweets.forEach(processTweet);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // 初始扫描
        forceRescan();
    }

    // 避免过早执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
