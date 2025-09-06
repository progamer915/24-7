const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const Movements = require('mineflayer-pathfinder').Movements;
const { GoalNear } = require('mineflayer-pathfinder').goals;
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');

// Load configuration
let config;
try {
  config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (error) {
  console.error('Error loading config.json:', error.message);
  process.exit(1);
}

// Bot state
let botState = {
  connected: false,
  position: { x: 0, y: 0, z: 0 },
  center: { x: config.patrol.centerX, y: config.patrol.centerY, z: config.patrol.centerZ },
  isPatrolling: false,
  currentTarget: null,
  health: 20,
  food: 20,
  lastChat: '',
  players: []
};

// Global bot variable
let bot;

// Function to create and configure bot
function createNewBot() {
  bot = mineflayer.createBot({
    host: config.server.host,
    port: config.server.port,
    username: config.bot.username,
    password: config.bot.password || undefined,
    version: config.bot.version
  });
  
  setupBotEvents();
}

// Function to setup bot event handlers
function setupBotEvents() {
  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

bot.on('spawn', () => {
  console.log('Bot spawned successfully!');
  botState.connected = true;
  botState.center = bot.entity.position.clone();
  console.log(`Center point set to: ${botState.center.x}, ${botState.center.y}, ${botState.center.z}`);
  
  // Set up pathfinder movements
  const movements = new Movements(bot);
  bot.pathfinder.setMovements(movements);
  
  // Start patrolling after a short delay
  setTimeout(startPatrolling, 2000);
});

bot.on('error', (err) => {
  console.log('Bot error:', err);
  botState.connected = false;
});

bot.on('end', (reason) => {
  console.log('Bot disconnected:', reason);
  botState.connected = false;
  // Try to reconnect after 5 seconds
  setTimeout(() => {
    console.log('Attempting to reconnect...');
    try {
      createNewBot();
    } catch (error) {
      console.log('Reconnection failed:', error.message);
    }
  }, 5000);
});

// Update bot position
bot.on('move', () => {
  if (bot.entity) {
    botState.position = {
      x: Math.round(bot.entity.position.x * 10) / 10,
      y: Math.round(bot.entity.position.y * 10) / 10,
      z: Math.round(bot.entity.position.z * 10) / 10
    };
  }
});

// Update health and food
bot.on('health', () => {
  botState.health = bot.health;
  botState.food = bot.food;
});

// Monitor chat for coordinates
bot.on('chat', (username, message) => {
  botState.lastChat = `${username}: ${message}`;
  console.log(`Chat: ${username}: ${message}`);
  
  // Check for coordinate pattern (x, y, z) or (x y z) or similar
  const coordPattern = /(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)/g;
  const matches = coordPattern.exec(message);
  
  if (matches) {
    const newX = parseInt(matches[1]);
    const newY = parseInt(matches[2]);
    const newZ = parseInt(matches[3]);
    
    console.log(`Coordinates detected from ${username}: ${newX}, ${newY}, ${newZ}`);
    bot.chat(`Got coordinates! Moving to ${newX}, ${newY}, ${newZ}`);
    
    // Update center point and move to new location
    botState.center = { x: newX, y: newY, z: newZ };
    moveToCenter();
  }
});

// Update player list
bot.on('playerJoined', (player) => {
  updatePlayerList();
});

bot.on('playerLeft', (player) => {
  updatePlayerList();
});

function updatePlayerList() {
  botState.players = Object.keys(bot.players).filter(name => name !== bot.username);
}

// Close setupBotEvents function
}

// Initialize the bot
createNewBot();

// Movement and patrolling functions
function getRandomPoint() {
  const radius = config.patrol.radius;
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * radius;
  
  return {
    x: botState.center.x + Math.cos(angle) * distance,
    y: botState.center.y,
    z: botState.center.z + Math.sin(angle) * distance
  };
}

async function moveToPosition(target) {
  if (!bot.pathfinder) {
    console.log('Pathfinder not available, using basic movement');
    return;
  }

  try {
    botState.currentTarget = target;
    await bot.pathfinder.goto(new GoalNear(target.x, target.y, target.z, 1));
    console.log(`Reached position: ${target.x}, ${target.y}, ${target.z}`);
  } catch (error) {
    console.log('Movement error:', error.message);
  }
}

async function moveToCenter() {
  console.log(`Moving to center: ${botState.center.x}, ${botState.center.y}, ${botState.center.z}`);
  await moveToPosition(botState.center);
}

async function patrol() {
  if (!botState.connected || !botState.isPatrolling) return;
  
  try {
    // Move to random point
    const randomPoint = getRandomPoint();
    console.log(`Patrolling to: ${randomPoint.x}, ${randomPoint.y}, ${randomPoint.z}`);
    await moveToPosition(randomPoint);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Return to center
    console.log('Returning to center');
    await moveToCenter();
    
    // Wait before next patrol
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Continue patrolling
    if (botState.isPatrolling) {
      patrol();
    }
  } catch (error) {
    console.log('Patrol error:', error.message);
    // Retry after a delay
    setTimeout(patrol, 5000);
  }
}

function startPatrolling() {
  if (botState.connected && !botState.isPatrolling) {
    botState.isPatrolling = true;
    console.log('Starting patrol...');
    patrol();
  }
}

function stopPatrolling() {
  botState.isPatrolling = false;
  console.log('Patrol stopped');
}

// Web server setup
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints
app.get('/api/bot-status', (req, res) => {
  res.json({
    connected: botState.connected,
    position: botState.position,
    center: botState.center,
    isPatrolling: botState.isPatrolling,
    health: botState.health,
    food: botState.food,
    lastChat: botState.lastChat,
    players: botState.players,
    uptime: bot.player ? Date.now() - bot.player.ping : 0
  });
});

app.post('/api/set-center', (req, res) => {
  const { x, y, z } = req.body;
  if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
    botState.center = { x, y, z };
    moveToCenter();
    res.json({ success: true, center: botState.center });
  } else {
    res.status(400).json({ error: 'Invalid coordinates' });
  }
});

app.post('/api/toggle-patrol', (req, res) => {
  if (botState.isPatrolling) {
    stopPatrolling();
  } else {
    startPatrolling();
  }
  res.json({ success: true, isPatrolling: botState.isPatrolling });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start web server
const server = app.listen(config.web.port, '0.0.0.0', () => {
  console.log(`Web dashboard running on port ${config.web.port}`);
  console.log(`Visit: http://localhost:${config.web.port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (bot) {
    bot.quit();
  }
  server.close();
  process.exit(0);
});

module.exports = { bot, botState };