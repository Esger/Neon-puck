// Game Constants
const PUCK_RADIUS = 15;
const HOLE_WIDTH = 100;
const WALL_THICKNESS = 20;
const FRICTION = 0.995;
const BOUNCE_DAMPING = 0.9;
const MAX_SPEED = 50;

const DRAG_FORCE = 0.30;
// We'll calculate dynamic GAP_OFFSET inside the level config to be responsive, or update it on resize.
// For now, let's keep it global but we might need to refresh it.
let GAP_OFFSET = 200; // Will be updated in handleResize

// State
let canvas, ctx;
let animationFrameId;
let lastFrameTime = 0;
let holePhases = [0, 0];
let gameState = "start"; // "start", "playing", "won"
let winner = null;
let pucks = [];
let activeTouches = new Map(); // Key: touchId, Value: { puckIndex, startX, startY, currentX, currentY, anchor, side }
let winTimestamp = null;

let width, height;

// Score State
let topWins = 0;
let bottomWins = 0;

// Level Transition State
let currentLevel = 0;
let transitionStartTime = 0;
let transitionDuration = 2000; // 2 seconds transition
let previousLevel = 0;

// Initialization
function init() {
    canvas = document.createElement('canvas');
    document.getElementById('game-container').appendChild(canvas);
    ctx = canvas.getContext('2d');

    // Use ResizeObserver for more robust sizing (fixes first-load issues)
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(document.getElementById('game-container'));

    // Initial size set
    handleResize();

    // Input Listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchCancel, { passive: false });

    // Start Loop
    lastFrameTime = performance.now();
    loop();
    updateScoreUI();
}

function handleResize() {
    const container = document.getElementById('game-container');
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    width = rect.width;
    height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
        if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
        ctx.scale(dpr, dpr);
    }

    // Update GAP_OFFSET based on new width
    GAP_OFFSET = Math.min(200, document.documentElement.clientWidth / 4);
}

function startGame() {
    pucks = [];
    activeTouches.clear();

    // Spawn 5 pucks for Top Player
    for (let i = 0; i < 5; i++) {
        pucks.push({
            id: i,
            x: width / 2 + (Math.random() * 200 - 100),
            y: height * 0.25 + (Math.random() * 100 - 50),
            vx: 0,
            vy: 0,
            color: "#00ff00"
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
            color: "#00ff00"
        });
    }

    gameState = "playing";
    winner = null;
    winTimestamp = null;

    // Set up transition
    previousLevel = currentLevel;
    // Current Level logic: wins=0 -> Level 1 (index 0). 
    // Wait, my previous code used: level = topWins + bottomWins + 1.
    // If we use currentLevel variable to store the "target level index", it's easier.
    // Let's say currentLevel stores the *target* wins count.
    const targetWins = topWins + bottomWins;

    // Only transition if level actually changed?
    // User wants "when advancing".
    // Even if we restart (same level), animating is fine? Maybe weird.
    // Let's always animate "into" the level.

    previousLevel = currentLevel; // This stores the previous WINS count.
    currentLevel = targetWins;

    transitionStartTime = Date.now();
}

// Level Configuration Helper
function getLevelConfig(wins) {
    const levelIndex = wins + 1; // 1-based level index

    // Base Config
    // holes: array of { baseOffset, speedFactor, rangeFactor, phase }
    // obstacles: boolean (true/false) - we interpolate radius 0->1

    // Level 1: 1 Static Hole (Center)
    if (levelIndex === 1) {
        return {
            holes: [
                { baseOffset: 0, speedFactor: 0, rangeFactor: 0, phase: 0 },
                { baseOffset: 0, speedFactor: 0, rangeFactor: 0, phase: 0 } // Second hole overlaps first
            ],
            hasObstacles: false
        };
    }

    // Level 2: 1 Moving Hole (Center)
    if (levelIndex === 2) {
        return {
            holes: [
                { baseOffset: 0, speedFactor: 1.0, rangeFactor: 0.22, phase: 0 },
                { baseOffset: 0, speedFactor: 1.0, rangeFactor: 0.22, phase: 0 }
            ],
            hasObstacles: false
        };
    }

    // Level 3: 2 Static Holes
    if (levelIndex === 3) {
        return {
            holes: [
                { baseOffset: -GAP_OFFSET, speedFactor: 0, rangeFactor: 0, phase: 0 },
                { baseOffset: GAP_OFFSET, speedFactor: 0, rangeFactor: 0, phase: 0 }
            ],
            hasObstacles: false
        };
    }

    // Level 4: 2 Moving Holes (Split)
    if (levelIndex === 4) {
        return {
            holes: [
                { baseOffset: -GAP_OFFSET, speedFactor: 0.35, rangeFactor: 0.35, phase: 0 },       // H1 Slower
                { baseOffset: GAP_OFFSET, speedFactor: 0.65, rangeFactor: 0.35, phase: Math.PI }  // H2 Faster
            ],
            hasObstacles: false
        };
    }

    // Level 5: 1 Moving Hole (Center) + Obstacles
    if (levelIndex === 5) {
        return {
            holes: [
                { baseOffset: 0, speedFactor: 1.0, rangeFactor: 0.22, phase: 0 },
                { baseOffset: 0, speedFactor: 1.0, rangeFactor: 0.22, phase: 0 }
            ],
            hasObstacles: true
        };
    }

    // Level 6+: 2 Moving Holes + Obstacles
    if (levelIndex >= 6) {
        return {
            holes: [
                { baseOffset: -GAP_OFFSET, speedFactor: 0.35, rangeFactor: 0.35, phase: 0 },       // H1 Slower
                { baseOffset: GAP_OFFSET, speedFactor: 0.65, rangeFactor: 0.35, phase: Math.PI }  // H2 Faster
            ],
            hasObstacles: true
        };
    }

    // Fallback
    return {
        holes: [{ baseOffset: 0, speedFactor: 0, rangeFactor: 0, phase: 0 }, { baseOffset: 0, speedFactor: 0, rangeFactor: 0, phase: 0 }],
        hasObstacles: false
    };
}

// Lerp Helper
function lerp(start, end, t) {
    return start + (end - start) * t;
}

// Easing Helper (Optional, simplified ease-out)
function easeOutQuad(t) {
    return t * (2 - t);
}

function getInterpolatedParams() {
    const time = Date.now();
    let t = (time - transitionStartTime) / transitionDuration;
    if (t > 1) t = 1;
    if (t < 0) t = 0;

    t = easeOutQuad(t); // Smooth ease out

    const startConfig = getLevelConfig(previousLevel);
    const endConfig = getLevelConfig(currentLevel);

    // Interpolate Holes
    const holes = [];
    for (let i = 0; i < 2; i++) {
        const hStart = startConfig.holes[i];
        const hEnd = endConfig.holes[i];

        holes.push({
            baseOffset: lerp(hStart.baseOffset, hEnd.baseOffset, t),
            speedFactor: lerp(hStart.speedFactor, hEnd.speedFactor, t),
            rangeFactor: lerp(hStart.rangeFactor, hEnd.rangeFactor, t),
            phase: lerp(hStart.phase, hEnd.phase, t) // Phase might spin if significant diff, but usually 0 or PI.
            // If phase flips 0 -> PI, it will rotate gracefully? Yes.
        });
    }

    // Interpolate Obstacle Presence (Radius multiplier)
    // If start has obs and end has obs: 1 -> 1
    // If start=0, end=1: 0 -> 1 (Grow)
    // If start=1, end=0: 1 -> 0 (Shrink)

    const obsStart = startConfig.hasObstacles ? 1.0 : 0.0;
    const obsEnd = endConfig.hasObstacles ? 1.0 : 0.0;
    const obsScale = lerp(obsStart, obsEnd, t);

    return { holes, obsScale };
}


// Updatable state for wall segments (calculated in update, used in render)
let currentParamState = null;

// Updated getWallSegments using interpolated params
function getWallSegments() {
    // If we haven't calculated state yet (e.g. first frame), do it
    if (!currentParamState) return [];

    const center = width / 2;
    const halfHole = HOLE_WIDTH / 2;

    const pos1 = center + currentParamState.holes[0].baseOffset + currentParamState.holes[0].offsetVal;
    const pos2 = center + currentParamState.holes[1].baseOffset + currentParamState.holes[1].offsetVal;

    // Always render 2 holes, sort them Left->Right to generate walls
    // If they overlap perfectly (like in Level 1/2/5), logic handles it.

    const holes = [pos1, pos2].sort((a, b) => a - b);
    const leftHole = holes[0];
    const rightHole = holes[1];

    // Walls:
    // 0 -> leftHole - half
    // leftHole + half -> rightHole - half
    // rightHole + half -> width

    // Safety clamp (though canvas coord don't crash, logical errors might occur if leftHole > rightHole due to sorting? No, sorted.)
    // But if (leftHole + half) > (rightHole - half), the middle wall is inverted (gap).
    // The physics loop handles inverted intervals as "match fail", i.e. NO wall.
    // However, renderer draws lineTo(end), which draws backwards lines filling the hole. Filter them out!

    const segments = [
        { start: 0, end: leftHole - halfHole },
        { start: leftHole + halfHole, end: rightHole - halfHole },
        { start: rightHole + halfHole, end: width }
    ];

    return segments.filter(s => s.end > s.start);
}

// Updated getObstacles
function getObstacles() {
    // Rely on the params calculated in update()
    if (!currentParamState || currentParamState.obsScale <= 0.01) return [];

    // Use params.obsScale ...

    const obsList = [];
    // Target Radius
    const targetRadius = (WALL_THICKNESS / 2) * 1.3;
    const currentRadius = targetRadius * currentParamState.obsScale;

    const center = width / 2;
    const topObsY = (height / 2 + height * 0.15) / 2;
    const bottomObsY = (height / 2 + height * 0.85) / 2;

    // Levels 5 & 6+ have obstacles.
    // Our interpolate params just says "obsScale".
    // Wait, WHERE are the obstacles?
    // In Level 5/6, they are always CENTERED.
    // If we transition to Level 5/6, we spawn them at center.
    // If previously we had obstacles at designated spots, we'd need to interpolate position too.
    // But fortunately, in the previous design, they were separate logic.
    // In the new request: "obstacles enter the scene by growing out of 0, in place".
    // Since Level 5 and 6 BOTH have Central Obstacles, position interpolation isn't needed between them.
    // Between L4 -> L5 (No obs -> Center obs): they grow at center. Correct.

    obsList.push({ x: center, y: topObsY, radius: currentRadius });
    obsList.push({ x: center, y: bottomObsY, radius: currentRadius });

    return obsList;
}

// Game Loop
function loop() {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    // Update Phase State
    const params = getInterpolatedParams();

    // We update phase accumulators using the interpolated speed factor
    // Base Speed logic: 0.0015 originally meant multiplier for Date.now() (ms).
    // So speed is radians per ms.
    // 0.0015 * (375 / width) is the base speed constant.
    const baseSpeedConst = 0.0015 * (375 / width);

    // Update Hole 1
    const s1 = params.holes[0].speedFactor * baseSpeedConst;
    holePhases[0] += s1 * dt;

    // Update Hole 2
    const s2 = params.holes[1].speedFactor * baseSpeedConst;
    holePhases[1] += s2 * dt;

    // Calc offsets for this frame
    const h1 = params.holes[0];
    const h2 = params.holes[1];

    // offset = sin(accumulatedPhase + targetPhaseShift) * range
    const off1 = Math.sin(holePhases[0] + h1.phase) * (width * h1.rangeFactor);
    const off2 = Math.sin(holePhases[1] + h2.phase) * (width * h2.rangeFactor);

    currentParamState = {
        holes: [
            { baseOffset: h1.baseOffset, offsetVal: off1 },
            { baseOffset: h2.baseOffset, offsetVal: off2 }
        ],
        obsScale: params.obsScale
    };

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
        ctx.arc(obs.x, obs.y, myMax(0, obs.radius), 0, Math.PI * 2); // Ensure positive radius
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
        const rotation = winner === "top" ? Math.PI : 0;
        drawOverlay(text, "Click to Restart", color, rotation);
    }
}
function myMax(a, b) { return a > b ? a : b; }

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

function drawOverlay(title, subtitle, color, rotation = 0) {
    // Pulsing semi-transparent background
    const pulse = Math.abs(Math.sin(Date.now() * 0.002)) * 0.1 + 0.7; // 0.7 to 0.8 opacity
    ctx.fillStyle = `rgba(0,0,0,${pulse})`;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(rotation);

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
    ctx.fillText(title, 0, -30);

    // Subtitle background pill
    const subFont = "30px Arial";
    ctx.font = subFont;
    const subWidth = ctx.measureText(subtitle).width;
    const pad = 20;

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.roundRect(-subWidth / 2 - pad, 20, subWidth + pad * 2, 50, 25);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Subtitle Text
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#ffffff";
    ctx.fillText(subtitle, 0, 45);
    ctx.shadowBlur = 0;

    ctx.restore();
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
