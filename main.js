// Game Constants
const PUCK_RADIUS = 15;
const HOLE_WIDTH = 100;
const WALL_THICKNESS = 20;
const FRICTION = 0.995;
const BOUNCE_DAMPING = 0.9;
const MAX_SPEED = 50;
const DRAG_FORCE = 0.30;

// State
let canvas, ctx;
let animationFrameId;
let gameState = "start"; // "start", "playing", "won"
let winner = null;
let pucks = [];
let activePuckIndex = null;
let dragStart = null;
let shotAnchor = null;
let width, height;

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
}

function handleResize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // If we resize during play, we might need to clamp pucks, but for now just let them be
    if (gameState === "start") {
        // Re-init if needed or just wait for start
    }
}

function startGame() {
    pucks = [];

    // Spawn 5 pucks for Top Player (Pink)
    for (let i = 0; i < 5; i++) {
        pucks.push({
            id: i,
            x: width / 2 + (Math.random() * 200 - 100),
            y: height * 0.25 + (Math.random() * 100 - 50),
            vx: 0,
            vy: 0,
            color: "#ff0099",
            owner: "top"
        });
    }

    // Spawn 5 pucks for Bottom Player (Blue)
    for (let i = 0; i < 5; i++) {
        pucks.push({
            id: i + 5,
            x: width / 2 + (Math.random() * 200 - 100),
            y: height * 0.75 + (Math.random() * 100 - 50),
            vx: 0,
            vy: 0,
            color: "#00f2ff",
            owner: "bottom"
        });
    }

    gameState = "playing";
    winner = null;
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
            // Skip physics for dragged puck
            if (index === activePuckIndex) return;

            // Movement
            puck.x += puck.vx / steps;
            puck.y += puck.vy / steps;

            // Wall Collisions
            if (puck.x - PUCK_RADIUS < 0) { puck.x = PUCK_RADIUS; puck.vx *= -BOUNCE_DAMPING; }
            if (puck.x + PUCK_RADIUS > width) { puck.x = width - PUCK_RADIUS; puck.vx *= -BOUNCE_DAMPING; }
            if (puck.y - PUCK_RADIUS < 0) { puck.y = PUCK_RADIUS; puck.vy *= -BOUNCE_DAMPING; }
            if (puck.y + PUCK_RADIUS > height) { puck.y = height - PUCK_RADIUS; puck.vy *= -BOUNCE_DAMPING; }

            // Center Barrier
            const wallY = height / 2;
            const wallLeftEnd = width / 2 - HOLE_WIDTH / 2;
            const wallRightStart = width / 2 + HOLE_WIDTH / 2;
            const halfWallThick = WALL_THICKNESS / 2;

            // Rectangular parts
            if (puck.y + PUCK_RADIUS >= wallY - halfWallThick && puck.y - PUCK_RADIUS <= wallY + halfWallThick) {
                // Left Wall
                if (puck.x <= wallLeftEnd) {
                    if (puck.y < wallY) puck.y = wallY - halfWallThick - PUCK_RADIUS - 1;
                    else puck.y = wallY + halfWallThick + PUCK_RADIUS + 1;
                    puck.vy *= -BOUNCE_DAMPING;
                }
                // Right Wall
                else if (puck.x >= wallRightStart) {
                    if (puck.y < wallY) puck.y = wallY - halfWallThick - PUCK_RADIUS - 1;
                    else puck.y = wallY + halfWallThick + PUCK_RADIUS + 1;
                    puck.vy *= -BOUNCE_DAMPING;
                }
            }

            // Cap Collisions (Circles at ends of walls)
            checkCapCollision(puck, wallLeftEnd, wallY, halfWallThick);
            checkCapCollision(puck, wallRightStart, wallY, halfWallThick);

            // Ball-to-Ball Collisions
            for (let j = index + 1; j < pucks.length; j++) {
                const other = pucks[j];
                if (activePuckIndex === j) continue;

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
    pucks.forEach(puck => {
        if (activePuckIndex !== puck.id) { // Assuming id matches index for now, but safer to check
            puck.vx *= FRICTION;
            puck.vy *= FRICTION;
        }

        if (puck.y < height / 2) topCount++;
        else bottomCount++;
    });

    // Win Condition
    if (topCount === 0) {
        gameState = "won";
        winner = "bottom";
    } else if (bottomCount === 0) {
        gameState = "won";
        winner = "top";
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

    // Center Line Left
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width / 2 - HOLE_WIDTH / 2, height / 2);
    ctx.stroke();

    // Center Line Right
    ctx.beginPath();
    ctx.moveTo(width / 2 + HOLE_WIDTH / 2, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.lineCap = "butt";

    // Rubber Bands
    const topBandY = height * 0.1;
    const bottomBandY = height * 0.9;

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
        drawOverlay("NEON PUCK", "Click to Start", "#ffffff");
    } else if (gameState === "won") {
        const color = winner === "top" ? "#ff0099" : "#00f2ff";
        const text = winner === "top" ? "PINK WINS!" : "BLUE WINS!";
        drawOverlay(text, "Click to Restart", color);
    }
}

function drawBand(y, owner, color) {
    ctx.beginPath();

    let pulled = false;
    if (activePuckIndex !== null && shotAnchor) {
        const puck = pucks[activePuckIndex];
        if (puck.owner === owner) {
            ctx.moveTo(0, y);
            ctx.lineTo(puck.x, puck.y);
            ctx.lineTo(width, y);
            pulled = true;
        }
    }

    if (!pulled) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }

    ctx.strokeStyle = color; // Simplified color for now
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
function handleStart(x, y) {
    if (gameState !== "playing") {
        if (gameState === "start" || gameState === "won") {
            startGame();
        }
        return;
    }

    // Hit Test
    const clickedIndex = pucks.findIndex(p => {
        const dx = p.x - x;
        const dy = p.y - y;
        return Math.sqrt(dx * dx + dy * dy) < PUCK_RADIUS * 3; // Generous hit area
    });

    if (clickedIndex !== -1) {
        const puck = pucks[clickedIndex];
        const isTop = y < height / 2;

        // Check ownership
        if ((puck.owner === "top" && isTop) || (puck.owner === "bottom" && !isTop)) {
            activePuckIndex = clickedIndex;
            dragStart = { x, y };
            puck.vx = 0;
            puck.vy = 0;
        }
    }
}

function handleMove(x, y) {
    if (activePuckIndex !== null) {
        const puck = pucks[activePuckIndex];
        const topBandY = height * 0.1;
        const bottomBandY = height * 0.9;

        puck.x = x;
        puck.y = y;

        // Constrain to side
        if (puck.owner === "top") {
            puck.y = Math.min(puck.y, height / 2 - PUCK_RADIUS - 10);

            // Engagement
            if (puck.y < topBandY) {
                if (!shotAnchor) shotAnchor = { x: puck.x, y: topBandY };
            } else {
                shotAnchor = null;
            }
        } else {
            puck.y = Math.max(puck.y, height / 2 + PUCK_RADIUS + 10);

            // Engagement
            if (puck.y > bottomBandY) {
                if (!shotAnchor) shotAnchor = { x: puck.x, y: bottomBandY };
            } else {
                shotAnchor = null;
            }
        }
    }
}

function handleEnd() {
    if (activePuckIndex !== null) {
        const puck = pucks[activePuckIndex];

        if (shotAnchor) {
            // Shoot
            const vx = (shotAnchor.x - puck.x) * DRAG_FORCE;
            const vy = (shotAnchor.y - puck.y) * DRAG_FORCE;

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

        activePuckIndex = null;
        dragStart = null;
        shotAnchor = null;
    }
}

// Event Wrappers
function onMouseDown(e) { handleStart(e.clientX, e.clientY); }
function onMouseMove(e) { handleMove(e.clientX, e.clientY); }
function onMouseUp(e) { handleEnd(); }

function onTouchStart(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    handleStart(t.clientX, t.clientY);
}
function onTouchMove(e) {
    e.preventDefault();
    const t = e.changedTouches[0];
    handleMove(t.clientX, t.clientY);
}
function onTouchEnd(e) {
    e.preventDefault();
    handleEnd();
}

// Init
init();
