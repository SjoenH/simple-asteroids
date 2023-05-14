// import * as signalR from '@microsoft/signalr';

import { Application, Sprite, Texture, Ticker } from 'pixi.js';

const app: Application = new Application();
document.body.appendChild(app.view as HTMLCanvasElement);

const playerSprite: Sprite = Sprite.from('/assets/Player.png');

// center anchor
playerSprite.anchor.set(0.5);
app.stage.addChild(playerSprite);

const asteroidSprite: Sprite = Sprite.from('/assets/Asteroid.png');

type Player = {
  id: string;
  position: {
    x: number;
    y: number;
  };
  acceleration: {
    x: number;
    y: number;
  };
  alive: boolean;
  rotation: number;
};
type Bullet = {
  id: string;
  position: {
    x: number;
    y: number;
  };
  acceleration: {
    x: number;
    y: number;
  };
  alive: boolean;
  rotation: number;
};


const players: Player[] = [];
players.push({
  id: '1234',
  position: {
    x: 100,
    y: 100,
  },
  acceleration: {
    x: 0,
    y: 0,
  },
  alive: true,
  rotation: 0,
});

let mousePosition = {
  x: 0,
  y: 0,
};

const asteroids = [
  {
    id: Math.random().toString(),
    position: {
      x: Math.random() * 1000,
      y: Math.random() * 1000,
    },
    acceleration: {
      x: Math.random() * 10,
      y: Math.random() * 10,
    },
    alive: true,
    rotation: 0,
  },
  {
    id: Math.random().toString(),
    position: {
      x: Math.random() * 1000,
      y: Math.random() * 1000,
    },
    acceleration: {
      x: Math.random() * 10,
      y: Math.random() * 10,
    },
    alive: true,
    rotation: 0,
  },
  {
    id: Math.random().toString(),
    position: {
      x: Math.random() * 1000,
      y: Math.random() * 1000,
    },
    acceleration: {
      x: Math.random() * 10,
      y: Math.random() * 10,
    },
    alive: true,
    rotation: 0,
  }

];
const bullets: Bullet[] = [];

const keysPressed = new Map<string, boolean>();

const tankId = '1234';

// Note, we do not modify the sprite directly, since we want to only update every frame
document.addEventListener('keydown', (e) => {
  const tank = players.find((t) => t.id === tankId);
  if (!tank) return;

  switch (e.code) {
    case 'ArrowUp':
      keysPressed.set('ArrowUp', true);
      break;
    case 'ArrowDown':
      keysPressed.set('ArrowDown', true);
      break;
    case 'ArrowLeft':
      keysPressed.set('ArrowLeft', true);
      break;
    case 'ArrowRight':
      keysPressed.set('ArrowRight', true);
      break;
    case 'Space':
      keysPressed.set('Space', true);
      break;
    default:
      break;
  }
});

document.addEventListener('keyup', (e) => {
  const tank = players.find((t) => t.id === tankId);
  if (!tank) return;

  switch (e.code) {
    case 'ArrowUp':
      keysPressed.set('ArrowUp', false);
      break;
    case 'ArrowDown':
      keysPressed.set('ArrowDown', false);
      break;
    case 'ArrowLeft':
      keysPressed.set('ArrowLeft', false);
      break;
    case 'ArrowRight':
      keysPressed.set('ArrowRight', false);
      break;
    case 'Space':
      keysPressed.set('Space', false);
      break;
    default:
      break;
  }
});


// rotate to follow mouse
document.addEventListener('mousemove', (e) => {
  mousePosition = {
    x: e.clientX,
    y: e.clientY,
  };
});

// Add all the sprites to the stage
app.stage.addChild(playerSprite);
asteroids.forEach(element => {
  const a = app.stage.addChild(asteroidSprite);
  a.x = element.position.x;
  a.y = element.position.y;
  a.rotation = element.rotation;
});

const bulletSprite = new Sprite(Texture.WHITE);
bulletSprite.width = 10;
bulletSprite.height = 10;
bulletSprite.tint = 0xffffff;

Ticker.shared.add((acceleration) => {
  // Update asteroid position
  asteroids.forEach((asteroid) => {
    const { acceleration: asteroidAcceleration, position: asteroidPosition } = asteroid;
    // asteroidPosition.x += asteroidAcceleration.x;
    // asteroidPosition.y += asteroidAcceleration.y;

    // Update sprite position and rotation
    asteroidSprite.x = asteroidPosition.x;
    asteroidSprite.y = asteroidPosition.y;
    asteroidSprite.rotation = asteroid.rotation;

    const { width, height } = app.screen;
    // if outside of screen, wrap
    if (asteroidPosition.x > width) {
      asteroidPosition.x = 0;
    }
    if (asteroidPosition.x < 0) {
      asteroidPosition.x = width;
    }
    if (asteroidPosition.y > height) {
      asteroidPosition.y = 0;
    }
    if (asteroidPosition.y < 0) {
      asteroidPosition.y = height;
    }


  });

  // Update player position
  const tank = players.find((t) => t.id === tankId);
  if (tank) {
    const { acceleration: tankAcceleration, position: tankPosition } = tank;
    if (keysPressed.get('ArrowUp')) {
      // tankAcceleration.y -= 1;
      // Move in the rotation direction
      tankAcceleration.x += Math.sin(tank.rotation) * 0.1;
      tankAcceleration.y -= Math.cos(tank.rotation) * 0.1;
    }
    if (keysPressed.get('ArrowDown')) {
      // tankAcceleration.y += 1;
      // Move in the rotation direction
      tankAcceleration.x -= Math.sin(tank.rotation) * 0.1;
      tankAcceleration.y += Math.cos(tank.rotation) * 0.1;
    }
    if (keysPressed.get('ArrowLeft')) {
      // tankAcceleration.x -= 1;
      tank.rotation -= 0.05;
    }
    if (keysPressed.get('ArrowRight')) {
      // tankAcceleration.x += 1;
      tank.rotation += 0.05;
    }

    // Space to shoot
    if (keysPressed.get('Space')) {
      // spawn bullet
      const bullet = {
        id: Math.random().toString(),
        position: {
          x: tankPosition.x,
          y: tankPosition.y,
        },
        acceleration: {
          x: Math.sin(tank.rotation) * 10,
          y: -Math.cos(tank.rotation) * 10,
        },
        alive: true,
        rotation: tank.rotation,
      };
      bullets.push(bullet);

      bulletSprite.anchor.set(0.5);
      bulletSprite.x = bullet.position.x;
      bulletSprite.y = bullet.position.y;
      bulletSprite.rotation = bullet.rotation;
      app.stage.addChild(bulletSprite);
    }

    // update bullets
    bullets.forEach((bullet) => {
      const { acceleration: bulletAcceleration, position: bulletPosition } = bullet;
      bulletPosition.x += bulletAcceleration.x;
      bulletPosition.y += bulletAcceleration.y;

      // Update sprite position and rotation
      bulletSprite.x = bulletPosition.x;
      bulletSprite.y = bulletPosition.y;
      bulletSprite.rotation = bullet.rotation;

      const { width, height } = app.screen;
      // if outside of screen, wrap
      if (bulletPosition.x > width) {
        bulletPosition.x = 0;
      }

      if (bulletPosition.x < 0) {
        bulletPosition.x = width;
      }

      if (bulletPosition.y > height) {
        bulletPosition.y = 0;
      }

      if (bulletPosition.y < 0) {
        bulletPosition.y = height;
      }
    });


    tankPosition.x += tankAcceleration.x;
    tankPosition.y += tankAcceleration.y;

    // Update sprite position and rotation
    playerSprite.x = tankPosition.x;
    playerSprite.y = tankPosition.y;
    playerSprite.rotation = tank.rotation;

    // if outside of screen, wrap around
    if (tankPosition.x < 0) {
      tankPosition.x = app.screen.width;
    }

    if (tankPosition.x > app.screen.width) {
      tankPosition.x = 0;
    }

    if (tankPosition.y < 0) {
      tankPosition.y = app.screen.height;
    }

    if (tankPosition.y > app.screen.height) {
      tankPosition.y = 0;
    }

    const speedLimit = 5;
    // limit speed
    if (tankAcceleration.x > speedLimit) {
      tankAcceleration.x = speedLimit;
    }
    if (tankAcceleration.y > speedLimit) {
      tankAcceleration.y = speedLimit;
    }

    if (tankAcceleration.x < -speedLimit) {
      tankAcceleration.x = -speedLimit;
    }
    if (tankAcceleration.y < -speedLimit) {
      tankAcceleration.y = -speedLimit;
    }
  }

  // If collision, reset position
  if (tank) {
    const { position: tankPosition } = tank;
    asteroids.forEach((asteroid) => {
      const { position: asteroidPosition } = asteroid;
      if (Math.abs(tankPosition.x - asteroidPosition.x) < 20 && Math.abs(tankPosition.y - asteroidPosition.y) < 20) {
        tankPosition.x = 0;
        tankPosition.y = 0;
      }
    });
  }
})



// const connection = new signalR.HubConnectionBuilder()
//   .withUrl('https://localhost:7159/game', {
//     skipNegotiation: true,
//     transport: signalR.HttpTransportType.WebSockets
//     // transport: signalR.HttpTransportType.LongPolling
//   }).build();

// connection.start().then(() => {
//   console.log('connected');
//   connection.send('SendMessage', "Hello from client");
//   connection.on('ReceiveMessage', () => {
//     // const existingTank = tanks.find((t) => t.id === tank.id);
//     // if (existingTank) {
//     //   existingTank.position = tank.position;
//     //   existingTank.acceleration = tank.acceleration;
//     //   existingTank.rotation = tank.rotation;
//     // } else {
//     //   tanks.push(tank);
//     // }
//     console.log("Received message from server");
//   })
// }).catch((err) => {
//   console.error(err);
// }
// );


// connection.on('ReceiveMessage', () => {
//   // const existingTank = tanks.find((t) => t.id === tank.id);
//   // if (existingTank) {
//   //   existingTank.position = tank.position;
//   //   existingTank.acceleration = tank.acceleration;
//   //   existingTank.rotation = tank.rotation;
//   // } else {
//   //   tanks.push(tank);
//   // }
//   console.log("Received message from server");
// });
