// ==UserScript==
// @name         Twitter Railgun Purge
// @namespace    http://tampermonkey.net/
// @version      1.0.0 - beta
// @description  Beta版本 试运行...
// @author       Sakurairinaqwq
// @match        https://twitter.com/*
// @match        https://x.com/*
// @icon         https://i.imgur.com/7J6f2n4.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
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
        timing: { tossUp: 600, reload: 800 }
    };

    // --- 状态管理 ---
    let blockList = GM_getValue('railgun_keywords', []);
    let userBlockList = GM_getValue('railgun_users', []);
    let remoteUrl = GM_getValue('railgun_remote_url', CONFIG.defaultRemote);
    let totalPurged = GM_getValue('railgun_total_purged', 0);

    let autoBanBots = GM_getValue('railgun_auto_ban', false);
    let isDevMode = GM_getValue('railgun_dev_mode', false);

    let apiConfig = GM_getValue('railgun_api_config', null);
    let isAnimating = false;

    // --- 样式注入 ---
    const css = `
        /* 基础动画 */
        @keyframes coin-toss-up { 0% { transform: translateY(0) rotateY(0) scale(1); } 50% { transform: translateY(-200px) rotateY(900deg) scale(1.4); box-shadow: 0 0 50px ${CONFIG.theme.primary}; } 100% { transform: translateY(-180px) rotateY(1800deg) scale(1.4); opacity: 1; } }
        @keyframes hyper-beam-core { 0% { transform: scaleX(0); opacity: 0.8; } 10% { transform: scaleX(1); opacity: 1; height: 20px; background: ${CONFIG.theme.core}; box-shadow: 0 0 60px ${CONFIG.theme.primary}, 0 0 120px ${CONFIG.theme.primary}; } 100% { transform: scaleX(2); opacity: 0; height: 2px; } }

        @keyframes coin-reload-drop { 0% { transform: translateY(-300px); opacity: 0; } 70% { transform: translateY(10px); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }

        #railgun-coin { position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; background: radial-gradient(circle at 30% 30%, #fff, #d0d0d0 40%, #222); border: 3px solid ${CONFIG.theme.primary}; border-radius: 50%; box-shadow: 0 0 20px rgba(255, 69, 0, 0.4); display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 100000; transition: transform 0.2s; will-change: transform; }
        #railgun-coin::after { content: '⚡'; font-size: 32px; background: linear-gradient(#fff, ${CONFIG.theme.accent}); -webkit-background-clip: text; color: transparent; font-weight: 900; filter: drop-shadow(0 0 5px ${CONFIG.theme.primary}); }
        #railgun-coin:hover { transform: scale(1.15); box-shadow: 0 0 40px ${CONFIG.theme.primary}; }
        #railgun-coin.tossing { animation: coin-toss-up ${CONFIG.timing.tossUp}ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards; pointer-events: none; }
        #railgun-coin.impacted { opacity: 0 !important; transition: none; pointer-events: none; }
        #railgun-coin.reloading { animation: coin-reload-drop ${CONFIG.timing.reload}ms cubic-bezier(0.19, 1, 0.22, 1) forwards; pointer-events: none; }

        #railgun-vfx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 99999; display: none; overflow: hidden; }
        .vfx-flash { position: absolute; inset: 0; background: white; opacity: 0; mix-blend-mode: screen; }
        .vfx-beam { position: absolute; top: calc(100vh - 210px); right: -50vw; width: 200vw; height: 14px; background: white; transform-origin: right center; opacity: 0; }
        body.railgun-firing .vfx-flash { animation: screen-flash-impact 0.4s ease-out forwards; }
        body.railgun-firing .vfx-beam { animation: hyper-beam-core 0.5s cubic-bezier(0,0.9,0.2,1) forwards; }
        @keyframes screen-flash-impact { 0% { opacity: 0; } 5% { opacity: 0.9; background: ${CONFIG.theme.primary}; } 100% { opacity: 0; } }

        /* --- 面板 (头部左对齐) --- */
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

        #railgun-panel.active {
            opacity: 1; transform: scale(1); pointer-events: auto;
            transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out;
        }

        /* 关键修改：justify-content 改为 flex-start，并增加 gap */
        .rg-header {
            display: flex; justify-content: flex-start; align-items: center; gap: 10px;
            border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 5px;
        }
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

        /* 关闭按钮 */
        .rg-close {
            position: absolute; top: 15px; right: 15px;
            width: 30px; height: 30px; border-radius: 50%;
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #888; font-size: 18px;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            z-index: 10;
        }
        .rg-close:hover {
            color: #fff; background: rgba(255, 69, 0, 0.8); border-color: #ff4500;
            transform: rotate(90deg) scale(1.1); box-shadow: 0 0 10px #ff4500;
        }

        .railgun-purged { display: none !important; }
        .railgun-dev-marked { position: relative; border: 2px dashed #ff0000 !important; background: rgba(255, 0, 0, 0.05) !important; box-sizing: border-box; }
        .railgun-dev-marked::before { content: '[BLOCK]'; position: absolute; top: 0; right: 0; background: #ff0000; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 6px; z-index: 10; }

        .rg-modal-overlay { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
        .rg-modal-overlay.visible { opacity: 1; pointer-events: auto; }
        .rg-modal { width: 320px; background: #111; border: 1px solid #ff4444; border-left: 6px solid #ff4444; padding: 24px; border-radius: 8px; box-shadow: 0 0 50px rgba(255, 0, 0, 0.3); font-family: "Microsoft YaHei", sans-serif; transform: scale(0.9); transition: transform 0.3s; }
        .rg-modal-overlay.visible .rg-modal { transform: scale(1); }
        .rg-modal h3 { margin: 0 0 15px 0; color: #ff4444; font-size: 16px; font-weight: 900; display: flex; align-items: center; gap: 8px; }
        .rg-modal h3::before { content: '⚠️'; font-size: 20px; }
        .rg-modal p { font-size: 12px; color: #ccc; line-height: 1.6; margin-bottom: 20px; }
        .rg-modal-actions { display: flex; gap: 10px; }
        .rg-modal-btn { flex: 1; padding: 10px; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; border: none; transition: opacity 0.2s; }
        .rg-btn-danger { background: #ff4444; color: #000; }
        .rg-btn-danger:hover { background: #ff0000; }
        .rg-btn-cancel { background: #333; color: #fff; }
        .rg-btn-cancel:hover { background: #444; }
    `;
    GM_addStyle(css);

    // --- 日志 ---
    function logToConsole(msg, type = 'info') {
        const consoleEl = document.getElementById('rg-console');
        if (!consoleEl) return;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const entry = document.createElement('div');
        entry.className = 'log-entry';

        let typeClass = `log-type-${type}`;
        entry.innerHTML = `<span class="log-time">[${time}]</span><span class="${typeClass}">[${type.toUpperCase()}]</span> ${msg}`;
        consoleEl.appendChild(entry);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    // --- 核心 ---
    function startSniffer() {
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            if (url.includes('/Retweeters') && url.includes('graphql')) {
                try {
                    const urlObj = new URL(url, window.location.origin);
                    const features = urlObj.searchParams.get('features');
                    const queryId = urlObj.pathname.split('/').slice(-2, -1)[0];
                    if (queryId && features && (!apiConfig || apiConfig.queryId !== queryId)) {
                        apiConfig = { baseUrl: urlObj.origin + urlObj.pathname, queryId, features };
                        GM_setValue('railgun_api_config', apiConfig);
                        logToConsole(`API 协议捕获: ${queryId.substring(0,8)}...`, 'sys');
                    }
                } catch (e) {}
            }
            originalOpen.apply(this, arguments);
        };
    }

    function launchDroneStrike(tweetId) {
        if (!apiConfig || !autoBanBots) return;
        logToConsole(`[自动处刑] 扫描蜂群 ID: ${tweetId}...`, 'info');
        const variables = JSON.stringify({ "tweetId": tweetId, "count": 40, "includePromotedContent": true });
        const targetUrl = `${apiConfig.baseUrl}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(apiConfig.features)}`;
        GM_xmlhttpRequest({
            method: "GET", url: targetUrl,
            headers: {
                "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "x-twitter-active-user": "yes", "x-csrf-token": getCookie("ct0"), "content-type": "application/json"
            },
            onload: function(response) {
                if (response.status === 200) {
                    try { processDroneData(JSON.parse(response.responseText)); } catch (e) { logToConsole('Drone 数据解析失败', 'warn'); }
                }
            }
        });
    }

    function getCookie(name) {
        const v = `; ${document.cookie}`;
        const parts = v.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return '';
    }

    function processDroneData(data) {
        let targets = [];
        try {
            const instructions = data.data.retweeters_timeline.timeline.instructions;
            instructions.forEach(ins => {
                if (ins.type === 'TimelineAddEntries') {
                    ins.entries.forEach(entry => {
                        const legacy = entry.content?.itemContent?.user_results?.result?.legacy;
                        if (legacy && legacy.screen_name) targets.push(legacy.screen_name.toLowerCase());
                    });
                }
            });
        } catch (e) { }

        if (targets.length > 0) {
            let newKills = 0;
            targets.forEach(user => {
                if (!userBlockList.includes(user)) {
                    userBlockList.push(user);
                    newKills++;
                }
            });
            if (newKills > 0) {
                GM_setValue('railgun_users', userBlockList);
                logToConsole(`>>> 处刑完毕: ${newKills} 个 Bot 已拉黑`, 'kill');
            } else {
                logToConsole(`扫描完毕: 目标已全部在黑名单中`, 'info');
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
                <span class="rg-ver">Beta 1.0.0</span>
            </div>

            <div id="rg-console">
                <div class="log-entry"><span class="log-time">[SYSTEM]</span><span class="log-type-sys">[INIT]</span> 系统就绪，等待指令。</div>
            </div>

            <div class="rg-switch-row" style="margin-bottom: 5px;">
                <span class="rg-switch-label">开发者模式 (标记不移除)</span>
                <label class="rg-switch">
                    <input type="checkbox" id="rg-dev-switch" ${isDevMode ? 'checked' : ''}>
                    <span class="rg-slider"></span>
                </label>
            </div>

            <div class="rg-switch-row">
                <span class="rg-switch-label">自动处刑 Bot (加入黑名单)</span>
                <label class="rg-switch">
                    <input type="checkbox" id="rg-autoban-switch" ${autoBanBots ? 'checked' : ''}>
                    <span class="rg-slider"></span>
                </label>
            </div>
            <div class="rg-danger-text">
                警告：开启自动处刑会导致高频拉黑操作，账号可能面临冻结风险。
            </div>

            <div style="margin-top:10px;">
                <label class="rg-label">云端规则库 (Raw JSON)</label>
                <input type="text" id="rg-remote-url" class="rg-input" value="${remoteUrl}">
            </div>

            <div style="margin-top:5px;">
                <label class="rg-label">本地关键词</label>
                <input type="text" id="rg-local-keywords" class="rg-input" value="${blockList.join(', ')}">
            </div>

            <button id="rg-sync-btn" class="rg-btn">同步云端数据</button>
            <div style="margin-top:8px; font-size:10px; color:#666; text-align:center;">已净化: ${totalPurged}</div>
        `;
        document.body.appendChild(panel);

        // 警告弹窗
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'rg-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="rg-modal">
                <h3>高危操作警告</h3>
                <p>
                    您正在尝试开启 <strong>自动处刑 (Auto-Ban)</strong> 功能。<br><br>
                    此功能会自动扫描并拉黑大量 Bot 账号。高频操作可能被 Twitter 判定为<strong>“滥用行为”</strong>，导致账号<strong>冻结</strong>或<strong>降权</strong>。<br><br>
                    确认开启即代表您承担一切风险。
                </p>
                <div class="rg-modal-actions">
                    <button id="rg-modal-confirm" class="rg-modal-btn rg-btn-danger">确认承担风险 (开启)</button>
                    <button id="rg-modal-cancel" class="rg-modal-btn rg-btn-cancel">取消操作</button>
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
        coin.title = "打开战术终端";
        document.body.appendChild(coin);

        // 打开面板
        coin.onclick = () => {
            if (isAnimating) return;
            isAnimating = true;
            coin.classList.remove('reloading');
            coin.classList.add('tossing');
            setTimeout(() => {
                vfxLayer.style.display = 'block';
                vfxLayer.offsetHeight;
                document.body.classList.add('railgun-firing');
                coin.classList.add('impacted');
                panel.classList.add('active'); // 触发进入动画
                if(apiConfig) logToConsole('API 状态: 在线 (Online)', 'sys');
                else logToConsole('API 状态: 离线 (请打开一次转推列表)', 'warn');
            }, CONFIG.timing.tossUp);
            setTimeout(() => { document.body.classList.remove('railgun-firing'); vfxLayer.style.display = 'none'; }, CONFIG.timing.tossUp + 400);
        };

        // 关闭面板
        panel.querySelector('.rg-close').onclick = () => {
            panel.classList.remove('active');
            setTimeout(() => {
                coin.classList.remove('tossing', 'impacted');
                void coin.offsetWidth;
                coin.classList.add('reloading');
                setTimeout(() => { coin.classList.remove('reloading'); isAnimating = false; }, CONFIG.timing.reload);
            }, 400);
        };

        // 弹窗逻辑
        const autobanSwitch = document.getElementById('rg-autoban-switch');
        autobanSwitch.addEventListener('click', (e) => {
            if (autobanSwitch.checked) {
                e.preventDefault();
                modalOverlay.classList.add('visible');
            } else {
                autoBanBots = false;
                GM_setValue('railgun_auto_ban', false);
                logToConsole(`自动处刑: 已关闭`, 'sys');
            }
        });
        document.getElementById('rg-modal-confirm').onclick = () => {
            modalOverlay.classList.remove('visible');
            autobanSwitch.checked = true;
            autoBanBots = true;
            GM_setValue('railgun_auto_ban', true);
            logToConsole(`[DANGER] 自动处刑已强制开启`, 'warn');
        };
        document.getElementById('rg-modal-cancel').onclick = () => {
            modalOverlay.classList.remove('visible');
            autobanSwitch.checked = false;
        };

        document.getElementById('rg-dev-switch').onchange = (e) => {
            isDevMode = e.target.checked;
            GM_setValue('railgun_dev_mode', isDevMode);
            logToConsole(`开发者模式: ${isDevMode ? '开启' : '关闭'}`, 'sys');
            document.querySelectorAll('.railgun-dev-marked').forEach(el => {
                el.classList.remove('railgun-dev-marked');
                el.removeAttribute('data-railgun-purged');
            });
            scanAndPurge();
        };

        document.getElementById('rg-sync-btn').onclick = () => {
            const url = document.getElementById('rg-remote-url').value;
            const locals = document.getElementById('rg-local-keywords').value.split(/,|，/).map(s => s.trim()).filter(s => s);
            GM_setValue('railgun_remote_url', url);
            GM_setValue('railgun_keywords', locals);
            logToConsole('正在同步...', 'info');
            GM_xmlhttpRequest({
                method: "GET", url: url + '?t=' + Date.now(),
                onload: (res) => {
                    try {
                        let json = res.responseText.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
                        let data = JSON.parse(json);
                        blockList = [...new Set([...locals, ...(data.keywords||[])])];
                        userBlockList = [...new Set([...userBlockList, ...(data.users||[])])];
                        GM_setValue('railgun_keywords', blockList);
                        GM_setValue('railgun_users', userBlockList);
                        logToConsole(`同步成功.`, 'sys');
                    } catch(e) { logToConsole('同步失败: JSON错误', 'warn'); }
                }
            });
        };
    }

    // --- 扫描 ---
    function fireRailgun(element, reason) {
        if (element.getAttribute('data-railgun-purged')) return;
        element.setAttribute('data-railgun-purged', 'true');

        if (isDevMode) {
            element.classList.add('railgun-dev-marked');
            element.title = `Railgun拦截: ${reason}`;
            logToConsole(`[DEV] 标记推文: ${reason}`, 'info');
        } else {
            element.style.display = 'none';
        }

        totalPurged++;
        GM_setValue('railgun_total_purged', totalPurged);

        if (autoBanBots) {
            const links = element.querySelectorAll('a[href*="/status/"]');
            let tweetId = null;
            for (let link of links) {
                const match = link.href.match(/\/status\/(\d+)/);
                if (match) { tweetId = match[1]; break; }
            }
            if (tweetId) {
                setTimeout(() => launchDroneStrike(tweetId), Math.random() * 2000 + 1000);
            }
        }
    }

    function scanAndPurge() {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach(tweet => {
            if (tweet.getAttribute('data-railgun-purged')) return;
            const text = tweet.innerText.toLowerCase();
            let hit = false;
            let hitReason = '';
            for (const kw of blockList) {
                if (text.includes(kw.toLowerCase())) { hit = true; hitReason = kw; break; }
            }
            if (!hit) {
               const userLinks = tweet.querySelectorAll('a[href^="/"]');
               for(let link of userLinks) {
                   const u = link.getAttribute('href').replace('/','').toLowerCase();
                   if(userBlockList.includes(u)) { hit = true; hitReason = `User:${u}`; break; }
               }
            }
            if (hit) fireRailgun(tweet, hitReason);
        });
    }

    function init() {
        console.log('Railgun Beta-1.0.0 Online');
        startSniffer();
        createUI();
        const observer = new MutationObserver(() => scanAndPurge());
        observer.observe(document.body, { childList: true, subtree: true });
        scanAndPurge();
    }

    window.addEventListener('load', init);
})();