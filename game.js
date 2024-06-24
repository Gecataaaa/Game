let camera, scene, renderer; // ThreeJS globals
let world; // CannonJS world
let lastTime; // Last timestamp of animation
let stack; // Parts that stay solid on top of each other
let overhangs; // Overhanging parts that fall down
const boxHeight = 1; // Height of each layer
const originalBoxSize = 3; // Original width and height of a box
let autopilot;
let gameEnded;
let robotPrecision; // Determines how precise the game is on autopilot
const scoreElement = document.getElementById("score");
const resultsElement = document.getElementById("results");
const levelElement = document.getElementById("level");
const nextLevelElement = document.getElementById("nextLevel");
let level = getLevelFromUrl();
let currentScore = 0;
const blocksToLevelUp = [11, 13, 15, 17, 19];

init();

function getLevelFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return parseInt(urlParams.get('level') || '1');
}

// Determines how precise the game is on autopilot
function setRobotPrecision() {
  robotPrecision = Math.random() * 1 - 0.5;
}

function init() {
  autopilot = true;
  gameEnded = false;
  lastTime = 0;
  stack = [];
  overhangs = [];
  setRobotPrecision();

  // Initialize CannonJS
  world = new CANNON.World();
  world.gravity.set(0, -10, 0); // Gravity pulls things down
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 40;

  // Initialize ThreeJs
  const aspect = window.innerWidth / window.innerHeight;
  const width = 10;
  const height = width / aspect;

  camera = new THREE.OrthographicCamera(
    width / -2, // left
    width / 2, // right
    height / 2, // top
    height / -2, // bottom
    0, // near plane
    100 // far plane
  );

  camera.position.set(4, 4, 4);
  camera.lookAt(0, 0, 0);

  scene = new THREE.Scene();

  // Set up lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(10, 20, 0);
  scene.add(dirLight);

  // Set up renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(animation);
  document.body.appendChild(renderer.domElement);

  // Handle window resize
  window.addEventListener("resize", onWindowResize);

  startGame(level);
}

function startGame(selectedLevel) {
  level = selectedLevel;
  currentScore = 0;
  autopilot = false;
  gameEnded = false;
  lastTime = 0;
  stack = [];
  overhangs = [];
  setRobotPrecision();

  if (resultsElement) resultsElement.style.display = "none";
  if (nextLevelElement) nextLevelElement.style.display = "none";
  if (scoreElement) {
    scoreElement.style.display = "block";
    scoreElement.innerText = currentScore;
  }
  if (levelElement) {
    levelElement.style.display = "block";
    levelElement.innerText = `Level: ${level}`;
  }

  if (world) {
    // Remove every object from world
    while (world.bodies.length > 0) {
      world.remove(world.bodies[0]);
    }
  }

  if (scene) {
    // Remove every Mesh from the scene
    while (scene.children.find((c) => c.type == "Mesh")) {
      const mesh = scene.children.find((c) => c.type == "Mesh");
      scene.remove(mesh);
    }

    // Foundation
    addLayer(0, 0, originalBoxSize, originalBoxSize);

    // First layer
    addLayer(-10, 0, originalBoxSize, originalBoxSize, "x");
  }

  if (camera) {
    // Reset camera positions
    camera.position.set(4, 4, 4);
    camera.lookAt(0, 0, 0);
  }
}

function addLayer(x, z, width, depth, direction) {
  const y = boxHeight * stack.length; // Add new layer on top of stack
  const layer = generateBox(x, y, z, width, depth);
  layer.direction = direction;
  stack.push(layer);
}

function addOverhang(x, z, width, depth) {
  const y = boxHeight * (stack.length - 1); // Add new layer on top of stack
  const overhang = generateBox(x, y, z, width, depth, true);
  overhangs.push(overhang);
}

function generateBox(x, y, z, width, depth, falls = false) {
  console.log(`Generating box at (${x}, ${y}, ${z}) with width ${width} and depth ${depth}`);
  // ThreeJS
  const colors = [0x1abc9c, 0x2ecc71, 0x3498db, 0x9b59b6, 0xf1c40f, 0xe67e22, 0xe74c3c];
  const color = colors[stack.length % colors.length];
  const geometry = new THREE.BoxGeometry(width, boxHeight, depth);
  const material = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  scene.add(mesh);

  // CannonJS
  const shape = new CANNON.Box(new CANNON.Vec3(width / 2, boxHeight / 2, depth / 2));
  let mass = falls ? 5 : 0;
  mass *= Math.pow(0.95, stack.length); // Reducing mass for higher levels
  const body = new CANNON.Body({ mass, shape });
  body.position.set(x, y, z);
  world.addBody(body);

  return {
    threejs: mesh,
    cannonjs: body,
    width,
    depth
  };
}

function cutBox(topLayer, overlap, size, delta) {
  const direction = topLayer.direction;
  const newWidth = direction == "x" ? overlap : topLayer.width;
  const newDepth = direction == "z" ? overlap : topLayer.depth;

  // Update metadata
  topLayer.width = newWidth;
  topLayer.depth = newDepth;

  // Update ThreeJS model
  topLayer.threejs.scale[direction] = overlap / size;
  topLayer.threejs.position[direction] -= delta / 2;

  // Update CannonJS model
  topLayer.cannonjs.position[direction] -= delta / 2;

  // Replace shape to a smaller one (in CannonJS you can't simply scale a shape)
  const shape = new CANNON.Box(new CANNON.Vec3(newWidth / 2, boxHeight / 2, newDepth / 2));
  topLayer.cannonjs.shapes = [];
  topLayer.cannonjs.addShape(shape);
}

function animation(time) {
  const timePassed = lastTime ? time - lastTime : 0;
  const speed = 0.008 + level * 0.002; // Increase speed with level

  if (stack.length === 0) return;

  const topLayer = stack[stack.length - 1];

  // Move block
  if (!gameEnded) {
    topLayer.threejs.position[topLayer.direction] += speed * timePassed;
    topLayer.cannonjs.position[topLayer.direction] += speed * timePassed;

    // Update camera position to follow the topmost block
    camera.position.y = Math.max(camera.position.y, topLayer.threejs.position.y + 4); // Adjust as needed

    // If block goes beyond the stack, end game
    if (topLayer.threejs.position[topLayer.direction] > 50) {
      if (!autopilot) endGame();
    }
  }

  // Handle collisions and stacking (autopilot logic)
  if (autopilot && stack.length > 1) {
    const prevLayer = stack[stack.length - 2];
    const currentPosition = topLayer.threejs.position[topLayer.direction];

    if (
      (topLayer.direction === "x" && currentPosition < prevLayer.threejs.position.x + robotPrecision) ||
      (topLayer.direction === "z" && currentPosition < prevLayer.threejs.position.z + robotPrecision)
    ) {
      if (Math.random() > 0.5) {
        if (stack.length < blocksToLevelUp[level]) {
          splitBlock();
        } else {
          showNextLevelScreen();
        }
      } else {
        cutBox(topLayer, topLayer.width, topLayer.width, robotPrecision);
      }
    }
  }

  // Remove blocks that go too high
  if (topLayer.threejs.position.y > 20) {
    scene.remove(topLayer.threejs);
    world.remove(topLayer.cannonjs);
    stack.pop(); // Remove from stack array

    // Adjust camera to follow the new topmost block
    const newTopLayer = stack[stack.length - 1];
    if (newTopLayer) {
      camera.position.y = Math.max(camera.position.y, newTopLayer.threejs.position.y + 4); // Adjust as needed
    }
  }

  // Update physics world
  world.step(timePassed / 1000);

  // Render scene
  renderer.render(scene, camera);

  lastTime = time;
}

// Handle window resize
function onWindowResize() {
  const aspect = window.innerWidth / window.innerHeight;
  const width = 10;
  const height = width / aspect;

  camera.left = width / -2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = height / -2;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Show next level screen
function showNextLevelScreen() {
  gameEnded = true;
  if (nextLevelElement) {
    nextLevelElement.style.display = "flex";
  }
  window.addEventListener("keydown", returnToMenu);
  window.addEventListener("mousedown", returnToMenu);
}

// Return to the menu
function returnToMenu() {
  window.location.href = 'menu.html';
}

// End the game
function endGame() {
  gameEnded = true;
  if (resultsElement) resultsElement.style.display = "flex";
  document.getElementById('returnButton').addEventListener('click', () => startGame(level));
  document.getElementById('menuButton').addEventListener('click', returnToMenu);
  document.getElementById('prevLevelButton').addEventListener('click', () => changeLevel(-1));
  document.getElementById('nextLevelButton').addEventListener('click', () => changeLevel(1));

  // Hide "Previous" button on the first level and "Next" button on the last level
  document.getElementById('prevLevelButton').style.display = level > 1 ? 'inline-block' : 'none';
  document.getElementById('nextLevelButton').style.display = level < blocksToLevelUp.length ? 'inline-block' : 'none';
}

// Event listeners for player input
window.addEventListener("mousedown", splitBlock);
window.addEventListener("keydown", (event) => {
  if (event.key == " ") splitBlock();
});

// Split the top block
function splitBlock() {
  if (stack.length < 2) return;

  const topLayer = stack[stack.length - 1];
  const previousLayer = stack[stack.length - 2];

  const direction = topLayer.direction;
  const size = direction == "x" ? topLayer.width : topLayer.depth;
  const delta = topLayer.threejs.position[direction] - previousLayer.threejs.position[direction];
  const overlap = size - Math.abs(delta);

  if (overlap > 0) {
    cutBox(topLayer, overlap, size, delta);

    // Overhanging part that falls down
    const overhangShift = (overlap / 2 + Math.abs(delta / 2)) * Math.sign(delta);
    const overhangX = direction == "x" ? topLayer.threejs.position.x + overhangShift : topLayer.threejs.position.x;
    const overhangZ = direction == "z" ? topLayer.threejs.position.z + overhangShift : topLayer.threejs.position.z;
    const overhangWidth = direction == "x" ? Math.abs(delta) : topLayer.width;
    const overhangDepth = direction == "z" ? Math.abs(delta) : topLayer.depth;

    addOverhang(overhangX, overhangZ, overhangWidth, overhangDepth);

    // Next layer
    const nextX = direction == "x" ? topLayer.threejs.position.x : -10;
    const nextZ = direction == "z" ? topLayer.threejs.position.z : -10;
    const nextDirection = direction == "x" ? "z" : "x";

    if (stack.length < blocksToLevelUp[level - 1]) {
      addLayer(nextX, nextZ, topLayer.width, topLayer.depth, nextDirection);
    } else {
      showNextLevelScreen();
    }

    currentScore++;
    if (scoreElement) scoreElement.innerText = currentScore;
  } else {
    endGame();
  }
}

function changeLevel(change) {
  const newLevel = Math.max(1, Math.min(level + change, blocksToLevelUp.length));
  window.location.href = `index.html?level=${newLevel}`;
}
