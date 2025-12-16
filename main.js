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
let topWins = 0;
let bottomWins = 0;

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
    window.addEventListener('touchend', onTouchEnd);

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
    ctx.scale(dpr, dpr);

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
        const nx = dx / dist;
        const ny = dy / dist;
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
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "bold 60px Arial";
    ctx.fillStyle = color;
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;
    ctx.fillText(title, width / 2, height / 2 - 20);
    ctx.shadowBlur = 0;

    ctx.font = "30px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(subtitle, width / 2, height / 2 + 40);
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
    const level = topWins + bottomWins;
    const center = width / 2;
    const halfHole = HOLE_WIDTH / 2;



    if (level === 0) {
        // Level 1: One central hole
        return [
            { start: 0, end: center - halfHole },
            { start: center + halfHole, end: width }
        ];
    } else if (level >= 4) {
        // Level 4: One moving hole
        // Adjust speed based on width to maintain consistent linear velocity across different screen sizes
        // Base value 0.0015 is tuned for 375px; wider screens need lower frequency since the range is larger.
        const speed = 0.0015 * (375 / width);
        const range = width * 0.22;
        const offset = Math.sin(Date.now() * speed) * range;
        return [
            { start: 0, end: center + offset - halfHole },
            { start: center + offset + halfHole, end: width }
        ];
    } else {
        // Level 2 & 3: Two holes
        // Hole 1 centered at center - GAP_OFFSET
        // Hole 2 centered at center + GAP_OFFSET
        //
        // Walls:
        // 1. Left of Hole 1
        // 2. Between Hole 1 and Hole 2 (Central Block)
        // 3. Right of Hole 2

        const hole1Center = center - GAP_OFFSET;
        const hole2Center = center + GAP_OFFSET;

        return [
            { start: 0, end: hole1Center - halfHole }, // Left Wall
            { start: hole1Center + halfHole, end: hole2Center - halfHole }, // Middle Block
            { start: hole2Center + halfHole, end: width } // Right Wall
        ];
    }
}

function getObstacles() {
    const level = topWins + bottomWins;
    // Obstacles start appearing after 2 wins (Level 2 & 3 only)
    if (level < 2 || level >= 4) return [];

    const center = width / 2;
    const hole1Center = center - GAP_OFFSET;
    const hole2Center = center + GAP_OFFSET;

    // Positioned exactly between wall and rubber band
    // Wall Y = height/2
    // Top Band Y = height * 0.15
    // Bottom Band Y = height * 0.85

    const topObsY = (height / 2 + height * 0.15) / 2;
    const bottomObsY = (height / 2 + height * 0.85) / 2;

    // Slightly bigger than half wall thickness to appear thicker visually
    const radius = (WALL_THICKNESS / 2) * 1.3;

    const level1Obstacles = [
        { x: hole2Center, y: topObsY, radius: radius },
        { x: hole1Center, y: bottomObsY, radius: radius },
    ];

    const level2Obstacles = [
        { x: hole1Center, y: topObsY, radius: radius },
        { x: hole2Center, y: bottomObsY, radius: radius },
    ];

    if (level === 2) {
        // Level 2: Only top obstacles (as requested "top left and top right")
        return level1Obstacles;
    } else {
        // Level 3+: 4 obstacles
        return [...level1Obstacles, ...level2Obstacles];
    }
}
