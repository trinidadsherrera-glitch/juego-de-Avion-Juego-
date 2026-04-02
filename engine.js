/* New module: engine.js
   Contains main game loop, rendering and most game logic.
   It depends on assets.js for images/audio and expects the DOM element ids to be provided at init().
*/

import nipplejs from 'nipplejs';

let canvas, ctx;
let elements = {};
let assetsModule = null;

// Game variables (kept here so module is self-contained)
let gameRunning = false;
let score = 0;
let lives = 5;
let lastTime = 0;
let nextEnemyTime = 0;
let nextCloudTime = 0;

// Shield state
let shieldActive = false;
let shieldTime = 0;
const SHIELD_DURATION = 3.0;
let shieldCooldown = 0;
const SHIELD_COOLDOWN = 5.0;

const player = {
    x: 100,
    y: 0,
    width: 110,
    height: 110,
    speed: 6,
    dx: 0,
    dy: 0,
    bullets: [],
    lastShot: 0,
    shootDelay: 250,
    angle: 0
};

let enemies = [];
let clouds = [];
let particles = [];
let counterMissiles = [];
let engineSoundSource = null;

function $(id) { return document.getElementById(id); }

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (!gameRunning) {
        player.y = canvas.height / 2 - player.height / 2;
    }
}

function setupJoystick(joystickZoneId) {
    const options = {
        zone: $(joystickZoneId),
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'white'
    };
    const joystick = nipplejs.create(options);

    joystick.on('move', (evt, data) => {
        if (data.vector) {
            player.dx = data.vector.x * player.speed;
            player.dy = -data.vector.y * player.speed;
            player.angle = Math.atan2(-data.vector.y, data.vector.x) * 0.1;
        }
    });

    joystick.on('end', () => {
        player.dx = 0;
        player.dy = 0;
        player.angle = 0;
    });
}

// input
const keys = {};
function setupKeyboard(shootCallback, shieldCallback) {
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') shootCallback();
        if (e.code === 'KeyE') shieldCallback();
    });
    window.addEventListener('keyup', (e) => keys[e.code] = false);
}
function handleKeyboard() {
    player.dx = 0;
    player.dy = 0;
    if (keys['ArrowUp'] || keys['KeyW']) player.dy = -player.speed;
    if (keys['ArrowDown'] || keys['KeyS']) player.dy = player.speed;
    if (keys['ArrowLeft'] || keys['KeyA']) player.dx = -player.speed;
    if (keys['ArrowRight'] || keys['KeyD']) player.dx = player.speed;

    if (player.dy !== 0) {
        player.angle = (player.dy > 0 ? 0.1 : -0.1);
    } else {
        player.angle = 0;
    }
}

// helpers that manipulate UI
function updateLivesUI() {
    const container = $(elements.livesContainerId);
    container.innerHTML = '';
    for (let i = 0; i < lives; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart';
        heart.innerHTML = '❤';
        container.appendChild(heart);
    }
}

function updateShieldUI() {
    const fill = $(elements.shieldFillId);
    const shieldBtn = $(elements.shieldBtnId);
    if (!fill) return;
    if (shieldActive) {
        const pct = Math.max(0, Math.min(1, shieldTime / SHIELD_DURATION));
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = 'linear-gradient(90deg,#4ee,#08f)';
        shieldBtn.style.opacity = '0.9';
    } else {
        const pct = shieldCooldown > 0 ? Math.max(0, Math.min(1, 1 - shieldCooldown / SHIELD_COOLDOWN)) : 1;
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = shieldCooldown > 0 ? 'linear-gradient(90deg,#888,#444)' : 'linear-gradient(90deg,#4efc9a,#08f)';
        shieldBtn.style.opacity = shieldCooldown > 0 ? '0.6' : '1';
    }
}

function updateScoreUI() {
    const el = $(elements.scoreId);
    if (el) el.innerText = `Score: ${score}`;
}

function playSound(buffer, loop = false) {
    return assetsModule.playSound(buffer, loop);
}

// Shooting
function shoot() {
    const now = Date.now();
    if (now - player.lastShot > player.shootDelay) {
        player.bullets.push({
            x: player.x + player.width - 10,
            y: player.y + player.height / 2,
            speed: 10,
            radius: 4
        });

        const spawnX = player.x + player.width / 2 + (Math.random() - 0.5) * 60;
        counterMissiles.push({
            x: spawnX,
            y: -30,
            speed: 6,
            turnSpeed: 0.08,
            life: 8
        });

        player.lastShot = now;
        playSound(assetsModule.sounds.shoot);
    }
}

// Shield
function activateShield() {
    if (!gameRunning) return;
    if (shieldCooldown > 0 || shieldActive) return;
    shieldActive = true;
    shieldTime = SHIELD_DURATION;
    shieldCooldown = SHIELD_COOLDOWN;
    updateShieldUI();
    if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
}

// Game update/draw (mostly moved from original game.js)
function createExplosion(x, y) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            color: Math.random() > 0.5 ? '#ff9800' : '#333'
        });
    }
}

function update(dt) {
    if (!gameRunning) return;
    const dts = dt * 0.001;

    if (shieldActive) {
        shieldTime -= dts;
        if (shieldTime <= 0) {
            shieldActive = false;
            shieldTime = 0;
        }
    } else {
        if (shieldCooldown > 0) {
            shieldCooldown -= dts;
            if (shieldCooldown < 0) shieldCooldown = 0;
        }
    }
    updateShieldUI();

    score += Math.floor(dt * 0.01);
    updateScoreUI();

    handleKeyboard();

    // Move player
    player.x += player.dx;
    player.y += player.dy;

    // Constrain player
    player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));

    // Update bullets
    player.bullets.forEach((b, i) => {
        b.x += b.speed;
        if (b.x > canvas.width) player.bullets.splice(i, 1);
    });

    // Spawn clouds
    if (Date.now() > nextCloudTime) {
        clouds.push({
            x: canvas.width,
            y: Math.random() * canvas.height,
            speed: 1 + Math.random() * 2,
            scale: 0.5 + Math.random() * 1.5,
            opacity: 0.3 + Math.random() * 0.5
        });
        nextCloudTime = Date.now() + 1000 + Math.random() * 2000;
    }

    // Update clouds
    clouds.forEach((c, i) => {
        c.x -= c.speed;
        if (c.x < -200) clouds.splice(i, 1);
    });

    // Spawn enemies
    if (Date.now() > nextEnemyTime) {
        if (Math.random() < 0.45) {
            enemies.push({
                x: canvas.width + 120,
                y: 40 + Math.random() * (canvas.height - 120),
                width: 90,
                height: 40,
                speed: 1.5 + Math.random() * 1.2,
                type: 'plane',
                fireCooldown: 1000 + Math.random() * 2000,
                lastFire: Date.now()
            });
            nextEnemyTime = Date.now() + 800 + Math.random() * 1200;
        } else {
            enemies.push({
                x: canvas.width + 50,
                y: Math.random() * (canvas.height - 40),
                width: 40,
                height: 14,
                speed: 4 + Math.random() * 3,
                turnSpeed: 0.02 + Math.random() * 0.03,
                angle: 0,
                isMissile: true
            });
            nextEnemyTime = Date.now() + Math.max(400, 1200 - (score * 10));
        }
    }

    // Update enemies and collisions
    enemies.forEach((e, ei) => {
        if (e.isMissile) {
            const targetX = player.x + player.width / 2;
            const targetY = player.y + player.height / 2;
            const dx = targetX - (e.x + e.width / 2);
            const dy = targetY - (e.y + e.height / 2);
            const desired = Math.atan2(dy, dx);
            let diff = desired - e.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            e.angle += diff * e.turnSpeed;
            e.x += Math.cos(e.angle) * e.speed;
            e.y += Math.sin(e.angle) * e.speed;
        } else if (e.type === 'plane') {
            e.x -= e.speed;
            if (Date.now() - e.lastFire > e.fireCooldown) {
                e.lastFire = Date.now();
                const mx = e.x;
                const my = e.y + e.height / 2;
                enemies.push({
                    x: mx - 10,
                    y: my,
                    width: 40,
                    height: 14,
                    speed: 4 + Math.random() * 2,
                    turnSpeed: 0.02 + Math.random() * 0.03,
                    angle: Math.atan2((player.y + player.height/2) - my, (player.x + player.width/2) - mx),
                    isMissile: true
                });
            }
        } else {
            e.x -= e.speed || 2;
        }

        // Shield collision
        if (shieldActive) {
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const sx = e.x + e.width / 2;
            const sy = e.y + e.height / 2;
            const dist = Math.hypot(px - sx, py - sy);
            const shieldRadius = Math.max(player.width, player.height) * 0.75;
            if (dist < shieldRadius) {
                enemies.splice(ei, 1);
                createExplosion(sx, sy);
                playSound(assetsModule.sounds.explosion);
                score += 50;
                return;
            }
        }

        // Player collision
        if (player.x < e.x + e.width && player.x + player.width > e.x &&
            player.y < e.y + e.height && player.y + player.height > e.y) {
            enemies.splice(ei, 1);
            createExplosion(player.x + player.width/2, player.y + player.height/2);
            if (!shieldActive) {
                lives--;
                updateLivesUI();
                playSound(assetsModule.sounds.explosion);
                if (lives <= 0) endGame();
            } else {
                playSound(assetsModule.sounds.explosion);
                score += 30;
            }
        }

        if (e.x < -300 || e.x > canvas.width + 300 || e.y < -200 || e.y > canvas.height + 200) enemies.splice(ei, 1);
    });

    // Update counter-missiles
    counterMissiles.forEach((cm, cmi) => {
        cm.life -= dt * 0.001;
        let nearest = null;
        let nearestDist = 1e9;
        enemies.forEach(en => {
            if (!en.isMissile) return;
            const dx = (en.x + en.width/2) - cm.x;
            const dy = (en.y + en.height/2) - cm.y;
            const d = Math.hypot(dx, dy);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = en;
            }
        });

        if (nearest) {
            const desired = Math.atan2((nearest.y + nearest.height/2) - cm.y, (nearest.x + nearest.width/2) - cm.x);
            const vx = Math.cos(desired) * cm.speed;
            const vy = Math.sin(desired) * cm.speed;
            cm.x += vx;
            cm.y += vy;

            if (cm.x > nearest.x && cm.x < nearest.x + nearest.width && cm.y > nearest.y && cm.y < nearest.y + nearest.height) {
                const idx = enemies.indexOf(nearest);
                if (idx !== -1) enemies.splice(idx, 1);
                createExplosion(cm.x, cm.y);
                playSound(assetsModule.sounds.explosion);
                counterMissiles.splice(cmi, 1);
            }
        } else {
            cm.y += cm.speed;
        }

        if (cm.y > canvas.height + 200 || cm.x < -200 || cm.x > canvas.width + 200 || cm.life <= 0) {
            counterMissiles.splice(cmi, 1);
        }
    });

    // Particles
    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) particles.splice(i, 1);
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw clouds
    clouds.forEach(c => {
        ctx.globalAlpha = c.opacity;
        ctx.drawImage(assetsModule.images.cloud, c.x, c.y, 200 * c.scale, 100 * c.scale);
    });
    ctx.globalAlpha = 1.0;

    // Particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Bullets
    ctx.fillStyle = '#ffff00';
    player.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Player
    ctx.save();
    ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
    ctx.rotate(player.angle);

    const r = 15;
    const w = player.width;
    const h = player.height;
    ctx.beginPath();
    ctx.moveTo(-w/2 + r, -h/2);
    ctx.lineTo(w/2 - r, -h/2);
    ctx.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
    ctx.lineTo(w/2, h/2 - r);
    ctx.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
    ctx.lineTo(-w/2 + r, h/2);
    ctx.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
    ctx.lineTo(-w/2, -h/2 + r);
    ctx.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(assetsModule.images.player, -player.width / 2, -player.height / 2, player.width, player.height);

    if (assetsModule.images.catFace) {
        const faceW = player.width * 0.5;
        const faceH = player.height * 0.5;
        const faceX = -player.width * 0.1 - faceW / 2;
        const faceY = -faceH / 2;
        ctx.drawImage(assetsModule.images.catFace, faceX, faceY, faceW, faceH);
    }

    ctx.restore();

    // Shield glow
    if (shieldActive) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#66ffff';
        ctx.lineWidth = 10;
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const rad = Math.max(player.width, player.height) * 0.75;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Enemies
    enemies.forEach(e => {
        if (e.isMissile) {
            ctx.save();
            const cx = e.x + e.width / 2;
            const cy = e.y + e.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate(e.angle);
            ctx.fillStyle = '#8b8b8b';
            ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
            ctx.beginPath();
            ctx.moveTo(e.width/2, 0);
            ctx.lineTo(e.width/2 + e.height, -e.height);
            ctx.lineTo(e.width/2 + e.height, e.height);
            ctx.closePath();
            ctx.fillStyle = '#b33';
            ctx.fill();
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), e.height/2 + (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, -e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), -e.height/2 - (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, -e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else {
            ctx.drawImage(assetsModule.images.enemy, e.x, e.y, e.width, e.height);
        }
    });

    // Counter missiles
    counterMissiles.forEach(cm => {
        ctx.save();
        ctx.translate(cm.x, cm.y);
        ctx.fillStyle = '#e33';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(6, 6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.fillRect(-3, 6, 6, 8);
        ctx.restore();
    });
}

function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function startGame() {
    if (assetsModule.audioCtx.state === 'suspended') {
        assetsModule.audioCtx.resume();
    }

    score = 0;
    lives = 5;
    enemies = [];
    player.bullets = [];
    clouds = [];
    counterMissiles = [];
    updateScoreUI();
    updateLivesUI();

    $(elements.startScreenId).classList.add('hidden');
    $(elements.gameOverId).classList.add('hidden');
    gameRunning = true;

    if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
    if (engineSoundSource) try { engineSoundSource.stop(); } catch(e){}
    engineSoundSource = playSound(assetsModule.sounds.engine, true);
}

function endGame() {
    gameRunning = false;
    $(elements.gameOverId).classList.remove('hidden');
    $(elements.finalScoreId).innerText = `Puntaje Final: ${score}`;
    if (engineSoundSource) {
        try { engineSoundSource.stop(); } catch(e){}
        engineSoundSource = null;
    }
}

// public init
export function init(opts) {
    elements = opts;
    canvas = document.getElementById(opts.canvasId);
    ctx = canvas.getContext('2d');

    assetsModule = null;
    import('./assets.js').then(m => {
        assetsModule = m;
        return assetsModule.loadAssets();
    }).then(() => {
        // wire controls/UI
        window.addEventListener('resize', resize);
        resize();

        // joystick & input
        setupJoystick(opts.joystickZoneId);
        setupKeyboard(shoot, activateShield);

        // hook shoot button on mobile
        const shootBtn = document.getElementById(opts.shootBtnId);
        if (shootBtn) {
            shootBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (gameRunning) shoot();
            }, {passive:false});
        }

        // shield button
        const shieldBtnEl = document.getElementById(opts.shieldBtnId);
        if (shieldBtnEl) {
            shieldBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                if (assetsModule.audioCtx.state === 'suspended') assetsModule.audioCtx.resume();
                activateShield();
            });
            shieldBtnEl.addEventListener('touchstart', (e) => {
                e.preventDefault();
                activateShield();
            }, {passive:false});
        }

        // volume button
        const volBtn = document.getElementById(opts.volumeBtnId);
        function updateVolButton() {
            if (!volBtn) return;
            volBtn.textContent = assetsModule.isMuted() ? '🔇' : '🔊';
        }
        if (volBtn) {
            volBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (assetsModule.audioCtx.state === 'suspended') assetsModule.audioCtx.resume();
                assetsModule.setMuted(!assetsModule.isMuted());
                // stop engine sound if muting
                if (assetsModule.isMuted() && engineSoundSource) {
                    try { engineSoundSource.stop(); } catch(e){}
                    engineSoundSource = null;
                } else if (!assetsModule.isMuted() && gameRunning && assetsModule.sounds.engine) {
                    engineSoundSource = playSound(assetsModule.sounds.engine, true);
                }
                updateVolButton();
            });
        }
        updateVolButton();

        // Start/restart handlers
        const startEl = document.getElementById(opts.startBtnId);
        const restartEl = document.getElementById(opts.restartBtnId);
        if (startEl) startEl.addEventListener('click', startGame);
        if (restartEl) restartEl.addEventListener('click', startGame);

        requestAnimationFrame(loop);
    });
}