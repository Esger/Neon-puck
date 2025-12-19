// Game Constants
const PUCK_RADIUS = 15;
const HOLE_WIDTH = 100;
const WALL_THICKNESS = 20;
const FRICTION = 0.995;
const BOUNCE_DAMPING = 0.9;
const MAX_SPEED = 50;

const DRAG_FORCE = 0.30;
const GAP_OFFSET = Math.min(200, document.documentElement.clientWidth / 4);

// State
let canvas, ctx;
let animationFrameId;
let gameState = "start"; // "start", "playing", "won"
let winner = null;
let pucks = [];
let activeTouches = new Map(); // Key: touchId, Value: { puckIndex, startX, startY, currentX, currentY, anchor, side }
let winTimestamp = null;

let width, height;

// Score State
// Score State
let topWins = 0;
let bottomWins = 0;
let currentLevel = 0;

// Initialization
function init() {
    canvas = document.createElement('canvas');
    document.getElementById('game-container').appendChild(canvas);
    ctx = canvas.getContext('2d');

    window.addEventListener('resize', handleResize);
    handleResize();

    // Input Listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    // Android can fire touchcancel (system gestures / app switch / notification shade).
    // If we don't end these touches, a puck can remain "dragged" forever (looks frozen).
    window.addEventListener('touchcancel', onTouchCancel, { passive: false });

    // Start Loop
    loop();
    updateScoreUI();
}

function handleResize() {
    const container = document.getElementById('game-container');
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set display size (css pixels)
    width = rect.width;
    height = rect.height;

    // Set actual size in memory (scaled to account for extra pixel density)
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Normalize coordinate system to use css pixels
    // IMPORTANT: don't accumulate scaling across resizes (common source of mobile lockups
    // after orientation/address-bar changes). Reset transform each time.
    if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
        // Fallback (older browsers)
        if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
        ctx.scale(dpr, dpr);
    }

    // If we resize during play, we might need to clamp pucks, but for now just let them be
    if (gameState === "start") {
        // Re-init if needed or just wait for start
    }
}

function startGame() {
    pucks = [];
    activeTouches.clear(); // Clear any active touches

    // Spawn 5 pucks for Top Player
    for (let i = 0; i < 5; i++) {
        pucks.push({
            id: i,
            x: width / 2 + (Math.random() * 200 - 100),
            y: height * 0.25 + (Math.random() * 100 - 50),
            vx: 0,
            vy: 0,
            color: "#00ff00" // Green
        });
    }

    // Spawn 5 pucks for Bottom Player
    for (let i = 0; i < 5; i++) {
        pucks.push({
            id: i + 5,
            x: width / 2 + (Math.random() * 200 - 100),
            y: height * 0.75 + (Math.random() * 100 - 50),
            vx: 0,
            vy: 0,
            color: "#00ff00" // Green
        });
    }

    gameState = "playing";
    winner = null;
    winTimestamp = null;
    currentLevel = topWins + bottomWins;
}

// Game Loop
function loop() {
    update();
    render();
    animationFrameId = requestAnimationFrame(loop);
}

function update() {
    if (gameState !== "playing") return;

    let topCount = 0;
    let bottomCount = 0;

    // Physics Steps
    const steps = 5;
    for (let s = 0; s < steps; s++) {
        pucks.forEach((puck, index) => {
            // Skip physics for dragged pucks
            let isDragged = false;
            for (const touch of activeTouches.values()) {
                if (touch.puckIndex === index) {
                    isDragged = true;
                    break;
                }
            }
            if (isDragged) return;

            // Movement
            puck.x += puck.vx / steps;
            puck.y += puck.vy / steps;

            // Wall Collisions
            if (puck.x - PUCK_RADIUS < 0) { puck.x = PUCK_RADIUS; puck.vx *= -BOUNCE_DAMPING; }
            if (puck.x + PUCK_RADIUS > width) { puck.x = width - PUCK_RADIUS; puck.vx *= -BOUNCE_DAMPING; }
            if (puck.y - PUCK_RADIUS < 0) { puck.y = PUCK_RADIUS; puck.vy *= -BOUNCE_DAMPING; }
            if (puck.y + PUCK_RADIUS > height) { puck.y = height - PUCK_RADIUS; puck.vy *= -BOUNCE_DAMPING; }

            // Center Barrier Logic
            const wallY = height / 2;
            const halfWallThick = WALL_THICKNESS / 2;

            const walls = getWallSegments();

            walls.forEach(segment => {
                const wallLeft = segment.start;
                const wallRight = segment.end;

                // Rectangular parts
                if (puck.y + PUCK_RADIUS >= wallY - halfWallThick && puck.y - PUCK_RADIUS <= wallY + halfWallThick) {
                    if (puck.x >= wallLeft && puck.x <= wallRight) {
                        if (puck.y < wallY) puck.y = wallY - halfWallThick - PUCK_RADIUS - 1;
                        else puck.y = wallY + halfWallThick + PUCK_RADIUS + 1;
                        puck.vy *= -BOUNCE_DAMPING;
                    }
                }

                // Cap Collisions (Circles at ends of walls)
                // We check caps for every segment end, unless it's the screen edge
                if (wallLeft > 0) checkCapCollision(puck, wallLeft, wallY, halfWallThick);
                if (wallRight < width) checkCapCollision(puck, wallRight, wallY, halfWallThick);
            });

            // Obstacles
            const obstacles = getObstacles();
            obstacles.forEach(obs => {
                checkCapCollision(puck, obs.x, obs.y, obs.radius);
            });


            // Ball-to-Ball Collisions
            for (let j = index + 1; j < pucks.length; j++) {
                const other = pucks[j];

                // Check if other is dragged
                let otherIsDragged = false;
                for (const touch of activeTouches.values()) {
                    if (touch.puckIndex === j) {
                        otherIsDragged = true;
                        break;
                    }
                }
                if (otherIsDragged) continue;

                const dx = other.x - puck.x;
                const dy = other.y - puck.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = PUCK_RADIUS * 2;

                if (dist < minDist) {
                    // Resolve Overlap
                    const overlap = minDist - dist;
                    const angle = Math.atan2(dy, dx);
                    const moveX = (Math.cos(angle) * overlap) / 2;
                    const moveY = (Math.sin(angle) * overlap) / 2;

                    puck.x -= moveX;
                    puck.y -= moveY;
                    other.x += moveX;
                    other.y += moveY;

                    // Resolve Velocity (Elastic)
                    const nx = dx / dist;
                    const ny = dy / dist;
                    const tx = -ny;
                    const ty = nx;

                    const dpTan1 = puck.vx * tx + puck.vy * ty;
                    const dpTan2 = other.vx * tx + other.vy * ty;

                    const dpNorm1 = puck.vx * nx + puck.vy * ny;
                    const dpNorm2 = other.vx * nx + other.vy * ny;

                    // Equal mass
                    const m1 = 1, m2 = 1;
                    const mom1 = (dpNorm1 * (m1 - m2) + 2 * m2 * dpNorm2) / (m1 + m2);
                    const mom2 = (dpNorm2 * (m2 - m1) + 2 * m1 * dpNorm1) / (m1 + m2);

                    puck.vx = tx * dpTan1 + nx * mom1;
                    puck.vy = ty * dpTan1 + ny * mom1;
                    other.vx = tx * dpTan2 + nx * mom2;
                    other.vy = ty * dpTan2 + ny * mom2;

                    puck.vx *= BOUNCE_DAMPING;
                    puck.vy *= BOUNCE_DAMPING;
                    other.vx *= BOUNCE_DAMPING;
                    other.vy *= BOUNCE_DAMPING;
                }
            }
        });
    }

    // Apply Friction & Count
    pucks.forEach((puck, index) => {
        let isDragged = false;
        for (const touch of activeTouches.values()) {
            if (touch.puckIndex === index) {
                isDragged = true;
                break;
            }
        }

        if (!isDragged) {
            puck.vx *= FRICTION;
            puck.vy *= FRICTION;
        }

        if (puck.y < height / 2) topCount++;
        else bottomCount++;
    });

    // Win Condition
    if (topCount === 0) {
        if (!winTimestamp) winTimestamp = Date.now() + 800; // 1 second delay
        else if (Date.now() > winTimestamp) {
            gameState = "won";
            winner = "top";
            topWins++;
            updateScoreUI();
        }
    } else if (bottomCount === 0) {
        if (!winTimestamp) winTimestamp = Date.now() + 800; // 1 second delay
        else if (Date.now() > winTimestamp) {
            gameState = "won";
            winner = "bottom";
            bottomWins++;
            updateScoreUI();
        }
    } else {
        winTimestamp = null; // Reset if condition lost (e.g. ball bounces back?)
    }
}

function checkCapCollision(puck, capX, capY, halfWallThick) {
    const dx = puck.x - capX;
    const dy = puck.y - capY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radiusSum = halfWallThick + PUCK_RADIUS;

    if (dist < radiusSum) {
        // Guard against dist === 0 which would generate NaNs and can freeze gameplay.
        const safeDist = dist > 1e-6 ? dist : 1e-6;
        const nx = dx / safeDist;
        const ny = dy / safeDist;
        const overlap = radiusSum - dist;

        puck.x += nx * overlap;
        puck.y += ny * overlap;

        const dp = puck.vx * nx + puck.vy * ny;
        puck.vx -= 2 * dp * nx;
        puck.vy -= 2 * dp * ny;

        puck.vx *= BOUNCE_DAMPING;
        puck.vy *= BOUNCE_DAMPING;
    }
}

function render() {
    // Clear
    ctx.fillStyle = "#0f1119";
    ctx.fillRect(0, 0, width, height);

    // Draw Field
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffffff";

    // Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#ffffff";

    const walls = getWallSegments();
    walls.forEach(segment => {
        ctx.beginPath();
        ctx.moveTo(segment.start, height / 2);
        ctx.lineTo(segment.end, height / 2);
        ctx.lineTo(segment.end, height / 2);
        ctx.stroke();
    });

    const obstacles = getObstacles();
    obstacles.forEach(obs => {
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ffffff";
        ctx.fill();
    });

    ctx.shadowBlur = 0;
    ctx.lineCap = "butt";

    // Rubber Bands
    const topBandY = height * 0.15; // Moved inwards for safety
    const bottomBandY = height * 0.85; // Moved inwards for safety

    drawBand(topBandY, "top", "#ff0099");
    drawBand(bottomBandY, "bottom", "#00f2ff");

    // Pucks
    pucks.forEach(puck => {
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, PUCK_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = puck.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = puck.color;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner ring
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, PUCK_RADIUS * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    // UI Overlays
    if (gameState === "start") {
        drawOverlay("NEON PUCK", "Click to Start", "#00ff00");
    } else if (gameState === "won") {
        const color = winner === "top" ? "#ff0099" : "#00f2ff";
        const text = winner === "top" ? "PINK WINS!" : "BLUE WINS!";
        drawOverlay(text, "Click to Restart", color);
    }
}

function drawBand(y, side, color) {
    ctx.beginPath();

    // We might have multiple pulls on the same band now (though unlikely with 2 hands, but possible)
    // Actually, usually one band per side. But if we support multi-touch, maybe we just draw the band to the *last* engaged puck on that side?
    // Or we could draw multiple lines if multiple pucks are pulled?
    // For simplicity and visual clarity, let's draw the band through ALL engaged pucks on that side, or just the one being pulled.
    // The reference implementation drew to the single active puck.
    // Let's find all touches that are engaged on this side.

    let engagedTouches = [];
    for (const touch of activeTouches.values()) {
        if (touch.side === side && touch.anchor) {
            engagedTouches.push(touch);
        }
    }

    if (engagedTouches.length > 0) {
        // If multiple, this might look weird. Let's just draw to the first one for now, or iterate?
        // Drawing a single line connecting them all might be cool but complex.
        // Let's just draw separate "V" shapes for each pull.

        for (const touch of engagedTouches) {
            const puck = pucks[touch.puckIndex];
            ctx.moveTo(0, y);
            ctx.lineTo(puck.x, puck.y);
            ctx.lineTo(width, y);
        }
    } else {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawOverlay(title, subtitle, color) {
    // Pulsing semi-transparent background
    const pulse = Math.abs(Math.sin(Date.now() * 0.002)) * 0.1 + 0.7; // 0.7 to 0.8 opacity
    ctx.fillStyle = `rgba(0,0,0,${pulse})`;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Main Title with Heavy Glow
    let fontSize = 90; // Bigger basic size cause it's condensed
    ctx.font = `bold ${fontSize}px 'Barlow Condensed', sans-serif`;

    // Auto-scale down if text is wider than screen
    let textWidth = ctx.measureText(title).width;
    const maxTextWidth = width * 0.9;

    if (textWidth > maxTextWidth) {
        fontSize = Math.floor(fontSize * (maxTextWidth / textWidth));
        ctx.font = `bold ${fontSize}px 'Barlow Condensed', sans-serif`;
    }

    ctx.fillStyle = color;
    ctx.shadowBlur = 40 + Math.abs(Math.sin(Date.now() * 0.005)) * 20; // Pulsing glow
    ctx.shadowColor = color;
    ctx.fillText(title, width / 2, height / 2 - 30);

    // Subtitle background pill
    const subFont = "30px Arial";
    ctx.font = subFont;
    const subWidth = ctx.measureText(subtitle).width;
    const pad = 20;

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.roundRect(width / 2 - subWidth / 2 - pad, height / 2 + 20, subWidth + pad * 2, 50, 25);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Subtitle Text
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#ffffff";
    ctx.fillText(subtitle, width / 2, height / 2 + 45);
    ctx.shadowBlur = 0;
}

// Input Handling
function handleStart(x, y, id) {
    if (gameState !== "playing") {
        if (gameState === "start" || gameState === "won") {
            startGame();
        }
        return;
    }

    // Check if this ID is already active (shouldn't happen usually)
    if (activeTouches.has(id)) return;

    // Hit Test
    // We need to make sure we don't pick up a puck that is ALREADY being dragged by another touch
    const clickedIndex = pucks.findIndex((p, index) => {
        // Check if already dragged
        for (const touch of activeTouches.values()) {
            if (touch.puckIndex === index) return false;
        }

        const dx = p.x - x;
        const dy = p.y - y;
        return Math.sqrt(dx * dx + dy * dy) < PUCK_RADIUS * 3;
    });

    if (clickedIndex !== -1) {
        const puck = pucks[clickedIndex];
        const isClickTop = y < height / 2;
        const isPuckTop = puck.y < height / 2;

        // Allow dragging if click and puck are on the same side
        if (isClickTop === isPuckTop) {
            const side = isClickTop ? "top" : "bottom";

            activeTouches.set(id, {
                puckIndex: clickedIndex,
                startX: x,
                startY: y,
                currentX: x,
                currentY: y,
                anchor: null,
                side: side
            });

            puck.vx = 0;
            puck.vy = 0;
        }
    }
}

function handleMove(x, y, id) {
    const touch = activeTouches.get(id);
    if (!touch) return;

    const puck = pucks[touch.puckIndex];
    const topBandY = height * 0.15;
    const bottomBandY = height * 0.85;

    puck.x = x;
    puck.y = y;
    touch.currentX = x;
    touch.currentY = y;

    // Constrain to the active side
    if (touch.side === "top") {
        puck.y = Math.min(puck.y, height / 2 - PUCK_RADIUS - 10);

        // Engagement
        if (puck.y < topBandY) {
            if (!touch.anchor) touch.anchor = { x: puck.x, y: topBandY };
        } else {
            touch.anchor = null;
        }
    } else {
        puck.y = Math.max(puck.y, height / 2 + PUCK_RADIUS + 10);

        // Engagement
        if (puck.y > bottomBandY) {
            if (!touch.anchor) touch.anchor = { x: puck.x, y: bottomBandY };
        } else {
            touch.anchor = null;
        }
    }
}

function handleEnd(id) {
    const touch = activeTouches.get(id);
    if (!touch) return;

    const puck = pucks[touch.puckIndex];

    if (touch.anchor) {
        // Shoot
        const vx = (touch.anchor.x - puck.x) * DRAG_FORCE;
        const vy = (touch.anchor.y - puck.y) * DRAG_FORCE;

        puck.vx = vx;
        puck.vy = vy;

        // Cap speed
        const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        if (speed > MAX_SPEED) {
            const ratio = MAX_SPEED / speed;
            puck.vx *= ratio;
            puck.vy *= ratio;
        }
    }

    activeTouches.delete(id);
}

// Event Wrappers
function onMouseDown(e) { handleStart(e.clientX, e.clientY, 'mouse'); }
function onMouseMove(e) { handleMove(e.clientX, e.clientY, 'mouse'); }
function onMouseUp(e) { handleEnd('mouse'); }

function onTouchStart(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handleStart(t.clientX, t.clientY, t.identifier);
    }
}
function onTouchMove(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handleMove(t.clientX, t.clientY, t.identifier);
    }
}
function onTouchEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handleEnd(t.identifier);
    }
}

function onTouchCancel(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handleEnd(t.identifier);
    }
}

// Init
init();

function updateScoreUI() {
    document.getElementById('score-top').innerHTML = renderTallyHTML(topWins);
    document.getElementById('score-bottom').innerHTML = renderTallyHTML(bottomWins);
}

function renderTallyHTML(count) {
    let html = '';
    const blocks = Math.floor(count / 5);
    const remainder = count % 5;

    for (let i = 0; i < blocks; i++) {
        html += '<div class="tally-block"><div class="mark"></div><div class="mark"></div><div class="mark"></div><div class="mark"></div><div class="slash"></div></div>';
    }

    if (remainder > 0) {
        html += '<div class="tally-block">';
        for (let i = 0; i < remainder; i++) {
            html += '<div class="mark"></div>';
        }
        html += '</div>';
    }

    return html;
}

function getWallSegments() {
    const level = currentLevel + 1; // 0-based wins -> 1-based levels
    const center = width / 2;
    const halfHole = HOLE_WIDTH / 2;

    // Helper for moving hole offset
    const getOffset = (speedFactor, rangeFactor, phase = 0) => {
        // Scale speed by width so it looks consistent on all devices
        // Base speed restored to 0.0015 for single hole
        const speed = 0.0015 * (375 / width) * speedFactor;
        const range = width * rangeFactor;
        return Math.sin(Date.now() * speed + phase) * range;
    };

    if (level === 1) {
        // 1 gat (Static)
        return [
            { start: 0, end: center - halfHole },
            { start: center + halfHole, end: width }
        ];

    } else if (level === 2 || level === 5) {
        // 2 - 1 bewegend gat
        // 5 - 1 bewegend gat (+ obstakels defined in getObstacles)
        const offset = getOffset(1.0, 0.22);
        return [
            { start: 0, end: center + offset - halfHole },
            { start: center + offset + halfHole, end: width }
        ];

    } else if (level === 3) {
        // 3 - 2 gaten (Static)
        const hole1Center = center - GAP_OFFSET;
        const hole2Center = center + GAP_OFFSET;
        return [
            { start: 0, end: hole1Center - halfHole },
            { start: hole1Center + halfHole, end: hole2Center - halfHole },
            { start: hole2Center + halfHole, end: width }
        ];

    } else if (level === 4 || level >= 6) {
        // 4 - 2 bewegende gaten; 1 sneller 1 langzamer
        // 6 - 2 bewegende gaten (+ obstakels defined in getObstacles)

        // Both holes centered, moving across the full width (overlapping)
        // Range increased to 0.35 * width (approx 35% each way, total 70% coverage)

        // Hole 1: Slower (0.7 -> 0.35: 50% slower than before)
        const offset1 = getOffset(0.35, 0.35);
        const h1 = center + offset1;

        // Hole 2: Faster (1.3 -> 0.65: 50% slower than before)
        const offset2 = getOffset(0.65, 0.35, Math.PI);
        const h2 = center + offset2;

        // Sort so we always draw LEFT -> RIGHT
        const holes = [h1, h2].sort((a, b) => a - b);
        const leftHole = holes[0];
        const rightHole = holes[1];

        // If holes overlap significantly, the "Middle" wall segment might have start > end.
        // The game loop wall collision logic (x >= start && x <= end) handles this by 
        // effectively treating it as no wall (a gap), which is visually and physically correct 
        // for merged holes.

        return [
            { start: 0, end: leftHole - halfHole }, // Left
            { start: leftHole + halfHole, end: rightHole - halfHole }, // Middle
            { start: rightHole + halfHole, end: width } // Right
        ];
    }

    // Default Fallback
    return [
        { start: 0, end: center - halfHole },
        { start: center + halfHole, end: width }
    ];
}

function getObstacles() {
    const level = currentLevel + 1; // 0-based wins -> 1-based levels
    const obsList = [];
    const radius = (WALL_THICKNESS / 2) * 1.3;
    const center = width / 2;

    // Obstacle Y positions (approx halfway between wall and rubber band)
    const topObsY = (height / 2 + height * 0.15) / 2;
    const bottomObsY = (height / 2 + height * 0.85) / 2;

    if (level === 5 || level >= 6) {
        // Levels 5 & 6: 2 obstacles total (1 Top Center, 1 Bottom Center)
        obsList.push({ x: center, y: topObsY, radius: radius });
        obsList.push({ x: center, y: bottomObsY, radius: radius });
    }

    return obsList;
}
