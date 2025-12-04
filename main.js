import Matter from 'matter-js';

// Module aliases
const Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    Bodies = Matter.Bodies,
    Composite = Matter.Composite,
    Events = Matter.Events,
    Mouse = Matter.Mouse,
    MouseConstraint = Matter.MouseConstraint,
    Vector = Matter.Vector,
    Body = Matter.Body;

// Create engine
const engine = Engine.create();
engine.gravity.y = 0; // Top-down view, no gravity

// Increase iterations for better collision detection (prevents tunneling)
engine.positionIterations = 10;
engine.velocityIterations = 10;

// Create renderer
const container = document.getElementById('game-container');
const render = Render.create({
    element: container,
    engine: engine,
    options: {
        width: window.innerWidth,
        height: window.innerHeight,
        wireframes: false,
        background: '#222'
    }
});

// Create runner
const runner = Runner.create();

// Game constants
const WALL_THICKNESS = 40; // Increased for better collision reliability
const BALL_RADIUS = 20;
const HOLE_SIZE = 120;
let BAND_MARGIN = 100; // Will be updated on resize

// Collision Categories
const CATEGORY_BALL = 0x0001;
const CATEGORY_WALL = 0x0002;
const CATEGORY_BAND = 0x0004;

// Function to create game objects
function createGameObjects() {
    const width = render.options.width;
    const height = render.options.height;

    BAND_MARGIN = height * 0.15; // 15% of screen height

    // Clear existing world
    Composite.clear(engine.world);
    Engine.clear(engine);

    // Walls
    const wallOptions = {
        isStatic: true,
        render: { fillStyle: '#555' },
        collisionFilter: { category: CATEGORY_WALL }
    };
    const walls = [
        // Outer walls
        Bodies.rectangle(width / 2, -WALL_THICKNESS / 2, width, WALL_THICKNESS, wallOptions), // Top
        Bodies.rectangle(width / 2, height + WALL_THICKNESS / 2, width, WALL_THICKNESS, wallOptions), // Bottom
        Bodies.rectangle(width + WALL_THICKNESS / 2, height / 2, WALL_THICKNESS, height, wallOptions), // Right
        Bodies.rectangle(-WALL_THICKNESS / 2, height / 2, WALL_THICKNESS, height, wallOptions), // Left
    ];

    // Center wall
    const centerWallWidth = (width - HOLE_SIZE) / 2;
    walls.push(
        Bodies.rectangle(centerWallWidth / 2, height / 2, centerWallWidth, WALL_THICKNESS, wallOptions), // Left part
        Bodies.rectangle(width - centerWallWidth / 2, height / 2, centerWallWidth, WALL_THICKNESS, wallOptions) // Right part
    );

    // Band Walls (Solid barriers)
    const bandOptions = {
        isStatic: true,
        render: { visible: false }, // Drawn manually
        collisionFilter: { category: CATEGORY_BAND }
    };
    // Top Band Area (Solid block above the line)
    walls.push(Bodies.rectangle(width / 2, BAND_MARGIN / 2, width, BAND_MARGIN, bandOptions));
    // Bottom Band Area (Solid block below the line)
    walls.push(Bodies.rectangle(width / 2, height - BAND_MARGIN / 2, width, BAND_MARGIN, bandOptions));

    // Balls (Pucks)
    const ballOptions = {
        restitution: 0.9,
        frictionAir: 0.01, // Slightly higher friction to stop them eventually
        render: { fillStyle: '#f00' },
        label: 'ball',
        collisionFilter: {
            category: CATEGORY_BALL,
            mask: CATEGORY_WALL | CATEGORY_BAND | CATEGORY_BALL
        }
    };

    const balls = [];
    // 3 balls for each player (example setup)
    // Ensure they start INSIDE the play area (between bands)
    const playHeight = height - 2 * BAND_MARGIN;
    const topZoneCenter = BAND_MARGIN + playHeight / 4;
    const bottomZoneCenter = height - BAND_MARGIN - playHeight / 4;

    // Top player balls
    balls.push(Bodies.circle(width / 2, topZoneCenter, BALL_RADIUS, ballOptions));
    balls.push(Bodies.circle(width / 3, topZoneCenter, BALL_RADIUS, ballOptions));
    balls.push(Bodies.circle(2 * width / 3, topZoneCenter, BALL_RADIUS, ballOptions));

    // Bottom player balls
    balls.push(Bodies.circle(width / 2, bottomZoneCenter, BALL_RADIUS, ballOptions));
    balls.push(Bodies.circle(width / 3, bottomZoneCenter, BALL_RADIUS, ballOptions));
    balls.push(Bodies.circle(2 * width / 3, bottomZoneCenter, BALL_RADIUS, ballOptions));

    Composite.add(engine.world, [...walls, ...balls]);
}

createGameObjects();

// Mouse control (removed/disabled for game logic, replaced by multi-touch)
// We can keep MouseConstraint for debugging on desktop if needed, but for the game logic we use touches.
// For desktop testing, we can map mouse events to our touch logic or just keep using mouse for single player testing.
// Let's implement a unified input handler that supports both if possible, or just focus on Touch + Mouse emulation.

const activeTouches = new Map(); // Map<identifier, { body: Body, startPos: Vector, currentPos: Vector, constraint: Constraint }>

function handleInputStart(x, y, identifier) {
    const bodies = Composite.allBodies(engine.world);
    // Find bodies under this point
    const clickedBodies = Matter.Query.point(bodies, { x, y });

    for (const body of clickedBodies) {
        if (body.label === 'ball') {
            // Disable collision with bands while dragging
            body.collisionFilter.mask = CATEGORY_WALL | CATEGORY_BALL;

            activeTouches.set(identifier, {
                body: body,
                startPos: { x, y },
                currentPos: { x, y },
                constraint: null // Will be created on move
            });
            break; // Only pick one body per touch
        }
    }
}

function handleInputMove(x, y, identifier) {
    if (activeTouches.has(identifier)) {
        const touchData = activeTouches.get(identifier);
        touchData.currentPos = { x, y };
        // We could also manually move the body to follow the finger if we want "dragging" feel
        // But for sling puck, usually you pull back the "band" while the ball stays or moves slightly?
        // "Balls can be grabbed and shot... by pulling it against the rubberband"
        // Usually this means the ball follows the finger until it hits the band limit?
        // Or the ball stays at the band and you pull the "string"?
        // Let's assume we drag the ball.

        // To drag the ball, we can set its position or apply velocity. 
        // Setting position directly can break physics collisions.
        // Better to use a constraint or set velocity.
        // But for simplicity in this MVP, let's just update the visual "aim" and maybe move the ball slightly?
        // Actually, if we want to "drag" the ball, we should use a temporary constraint (like MouseConstraint does).

        // Let's try just updating the `currentPos` for the visual band, and maybe keep the ball at the touch position?
        // If we move the ball, we need to respect walls.
        // A temporary constraint is best.

        if (!touchData.constraint) {
            touchData.constraint = Matter.Constraint.create({
                pointA: { x, y },
                bodyB: touchData.body,
                stiffness: 0.2,
                damping: 0.1,
                length: 0,
                render: { visible: false }
            });
            Composite.add(engine.world, touchData.constraint);
        }

        touchData.constraint.pointA = { x, y };
    }
}

function handleInputEnd(identifier) {
    if (activeTouches.has(identifier)) {
        const touchData = activeTouches.get(identifier);

        // Remove constraint
        if (touchData.constraint) {
            Composite.remove(engine.world, touchData.constraint);
        }

        // Fire!
        fireBall(touchData.body, touchData.currentPos);

        activeTouches.delete(identifier);
    }
}

// Touch Events
render.canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        handleInputStart(touch.clientX, touch.clientY, touch.identifier);
    }
});

render.canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        handleInputMove(touch.clientX, touch.clientY, touch.identifier);
    }
});

render.canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        handleInputEnd(touch.identifier);
    }
});

// Mouse Events (for desktop testing)
render.canvas.addEventListener('mousedown', (e) => {
    handleInputStart(e.clientX, e.clientY, 'mouse');
});

render.canvas.addEventListener('mousemove', (e) => {
    handleInputMove(e.clientX, e.clientY, 'mouse');
});

render.canvas.addEventListener('mouseup', (e) => {
    handleInputEnd('mouse');
});


// Run the engine
Runner.run(runner, engine);
Render.run(render);

// Handle window resize
window.addEventListener('resize', () => {
    // Reload to reset physics and layout
    location.reload();
});

// Restore collisions when ball enters play area
Events.on(engine, 'beforeUpdate', function () {
    const bodies = Composite.allBodies(engine.world);
    const width = render.options.width;
    const height = render.options.height;

    bodies.forEach(body => {
        if (body.label === 'ball') {
            // Check if it's missing the BAND mask
            if ((body.collisionFilter.mask & CATEGORY_BAND) === 0) {
                // Check if it is safely inside the play area
                // (Between the two bands)
                if (body.position.y > BAND_MARGIN + BALL_RADIUS + 5 &&
                    body.position.y < height - BAND_MARGIN - BALL_RADIUS - 5) {

                    // Restore collision with bands
                    body.collisionFilter.mask = CATEGORY_WALL | CATEGORY_BAND | CATEGORY_BALL;
                }
            }
        }
    });
});

// Shooting Mechanic (Updated for multi-touch)
function fireBall(body, endPosition) {
    if (body.label !== 'ball') return;

    const width = render.options.width;
    const height = render.options.height;
    const isTopSide = body.position.y < height / 2;

    // Define band line Y coordinate
    const bandY = isTopSide ? BAND_MARGIN : height - BAND_MARGIN;

    // Check if pulled back correctly
    let shouldFire = false;
    if (isTopSide && body.position.y < bandY) {
        shouldFire = true;
    } else if (!isTopSide && body.position.y > bandY) {
        shouldFire = true;
    }

    if (shouldFire) {
        // Calculate force
        const forceMultiplier = 0.003; // Increased speed
        const maxForce = 0.1; // Increased cap

        let forceY = (bandY - body.position.y) * forceMultiplier;

        // Clamp force
        if (Math.abs(forceY) > maxForce) {
            forceY = maxForce * Math.sign(forceY);
        }

        Body.applyForce(body, body.position, {
            x: 0,
            y: forceY
        });
    }
}

// Visuals for the rubber band
Events.on(render, 'afterRender', function () {
    const ctx = render.context;
    const width = render.options.width;
    const height = render.options.height;

    // Draw Band Lines (visual guide)
    ctx.beginPath();
    ctx.moveTo(0, BAND_MARGIN);
    ctx.lineTo(width, BAND_MARGIN);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 6; // Thicker lines
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, height - BAND_MARGIN);
    ctx.lineTo(width, height - BAND_MARGIN);
    ctx.stroke();

    // Draw active bands for all touches
    activeTouches.forEach((data) => {
        const body = data.body;
        const isTopSide = body.position.y < height / 2;
        const bandY = isTopSide ? BAND_MARGIN : height - BAND_MARGIN;

        // Check if "tension" exists
        if ((isTopSide && body.position.y < bandY) ||
            (!isTopSide && body.position.y > bandY)) {

            ctx.beginPath();
            ctx.moveTo(0, bandY);
            ctx.lineTo(body.position.x, body.position.y);
            ctx.lineTo(width, bandY);

            ctx.lineWidth = 6; // Thicker active band
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }
    });
});

// Win Condition Check
Events.on(engine, 'afterUpdate', function () {
    const width = render.options.width;
    const height = render.options.height;

    let topBalls = 0;
    let bottomBalls = 0;

    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.label === 'ball') {
            if (body.position.y < height / 2) {
                topBalls++;
            } else {
                bottomBalls++;
            }
        }
    });

    if (topBalls === 0) {
        showWinMessage("Top Player Wins!");
    } else if (bottomBalls === 0) {
        showWinMessage("Bottom Player Wins!");
    }
});

function showWinMessage(message) {
    if (engine.enabled === false) return;

    engine.enabled = false;
    runner.enabled = false;

    const msg = document.createElement('div');
    msg.style.position = 'absolute';
    msg.style.top = '50%';
    msg.style.left = '50%';
    msg.style.transform = 'translate(-50%, -50%)';
    msg.style.color = 'white';
    msg.style.fontSize = '40px';
    msg.style.fontFamily = 'Arial, sans-serif';
    msg.style.background = 'rgba(0,0,0,0.8)';
    msg.style.padding = '20px';
    msg.style.borderRadius = '10px';
    msg.style.textAlign = 'center';
    msg.innerText = message;

    const btn = document.createElement('button');
    btn.innerText = "Restart";
    btn.style.display = 'block';
    btn.style.margin = '20px auto 0';
    btn.style.fontSize = '20px';
    btn.style.padding = '10px 20px';
    btn.style.cursor = 'pointer';
    btn.onclick = () => location.reload();
    msg.appendChild(btn);

    document.body.appendChild(msg);
}
