import * as signalR from '@microsoft/signalr';

import { Application, Sprite, Ticker } from 'pixi.js';

const app: Application = new Application();
document.body.appendChild(app.view as HTMLCanvasElement);

const assets: Record<string, string> = {
  player: '/assets/Player.png',
  asteroid: '/assets/Asteroid.png',
  bullet: '/assets/Bullet.png',
  star: '/assets/Star.png'
};

const sprites: Record<string, Sprite> = {};

/**
 * Adds a sprite to the stage and stores it in the sprites object
 * @param asset the path to the asset you want to add
 * @param spriteName the name you want to give the sprite
 * @param x initial x position
 * @param y initial y position
 * @param size the size of the sprite (1 = 100%)
 */
function addSprite(asset: string, spriteName: string, x: number, y: number, size: number = 1) {
  const sprite: Sprite = Sprite.from(asset);
  sprite.anchor.set(0.5);
  app.stage.addChild(sprite);
  sprites[spriteName] = sprite;
  sprite.x = x;
  sprite.y = y;
  sprite.scale.set(size);
  return sprite;
}

/**
 * Removes a sprite from the stage and deletes it from the sprites object
 * @param id the name of the sprite you want to remove
 */
function removeSprite(id: string) {
  app.stage.removeChild(sprites[id]);
  delete sprites[id];
}

/**
 * Updates the position of a sprite if it exists, otherwise adds it to the stage
 * @param id 
 * @param x 
 * @param y 
 */
function upsertSprite(id: string, x: number, y: number, asset = assets.player) {
  if (sprites[id]) {
    sprites[id].x = x;
    sprites[id].y = y;
  } else {
    addSprite(asset, id, x, y);
  }
}

function addMainPlayer(id: string = 'player1',
  x: number = 100, y: number = 100) {
  const player = addSprite(assets.player, id, x, y);
  // color it yellow
  player.tint = 0xffff00;
}

function addOtherPlayer(id: string = 'player2',
  x: number = 400, y: number = 400) {
  const p = addSprite(assets.player, id, x, y);
  // color it red
  p.tint = 0xff0000;
}
function addAsteroid(id: string = 'asteroid1',
  x: number = 200, y: number = 200, size: number = 1) {
  addSprite(assets.asteroid, 'asteroid', x, y, size);
}

function addBullet(id: string = 'bullet1', x: number = 300, y: number = 300) {
  addSprite(assets.bullet, id, x, y);
}

const stars: Sprite[] = [];
function addBackground() {
  // Sprinkle the background with some stars
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * app.screen.width;
    const y = Math.random() * app.screen.height;
    const star = addSprite(assets.star, `star${i}`, x, y, 0.5);
    stars.push(star); // so we can animate them later
  }
}
// startGame: Starts the game by loading assets, initializing sprites, and adding the game loop logic.
async function startGame(): Promise<void> {
  // Add some test sprites
  addBackground();
  addMainPlayer();
  addAsteroid();
  addBullet();
  addOtherPlayer();

  // If you want to, you could do some custom animation or logic inside the game loop
  Ticker.shared.add(() => {
    // Note, that this front-end is super simple and dumb,
    // so we don't have any game logic and all we do is update sprites when we get events from the server.

    // But this could be a good place to do it if we wanted the front-end to do some of the game logic.

    // But animating the stars is not part of the game logic, so we can do that here:
    stars.forEach((star) => {
      // We can use the FPS to throttle the animation 
      // so it doesn't impact performance on slower devices
      const fps = Ticker.shared.FPS;
      if (fps > 120) star.alpha = Math.random() * 0.5 + 0.5;
    });

  });
}

startGame();

///
//  SignalR - Connection and Event Handling
///
const connection = new signalR.HubConnectionBuilder()
  .withUrl('https://localhost:7159/game', {
    skipNegotiation: true,
    transport: signalR.HttpTransportType.WebSockets
    // transport: signalR.HttpTransportType.LongPolling
  }).build();

connection.start().then(() => {

  // Todo: Handle connection events
  // Here are some examples of events you could handle

  // When the player joins, we need to add the sprite
  connection.on('playerJoined', (id: string) => {
    console.log('playerJoined', id);
    // Note, that we don't need to add the main player, since it's already added
    addOtherPlayer(id);
  });

  // When the player leaves, we need to remove the sprite
  connection.on('playerLeft', (id: string) => {
    console.log('playerLeft', id);
    removeSprite(id);
  });

  connection.on('playerMoved', (id: string, x: number, y: number) => {
    console.log('playerMoved', id, x, y);
    upsertSprite(id, x, y);
  });

  connection.on('asteroidMoved', (id: string, x: number, y: number) => {
    console.log('asteroidMoved', id, x, y);
    upsertSprite(id, x, y, assets.asteroid);
  });

  connection.on('bulletMoved', (id: string, x: number, y: number) => {
    console.log('bulletMoved', id, x, y);
    upsertSprite(id, x, y, assets.bullet);
  });

  // When the bullet is removed, we need to remove the sprite
  // This happens when the bullet hits an asteroid or goes off screen
  connection.on('bulletRemoved', (id: string) => {
    console.log('bulletRemoved', id);
    removeSprite(id);
  });

  // When the asteroid is removed, we need to remove the sprite
  // This happens when the asteroid is hit by a bullet
  connection.on('asteroidRemoved', (id: string) => {
    console.log('asteroidRemoved', id);
    removeSprite(id);
  });


  // When the player is killed, we need to remove the sprite
  connection.on('playerKilled', (id: string) => {
    console.log('playerKilled', id);
    removeSprite(id);
    // We could also add an explosion animation here
    // and then remove the explosion animation when the player respawns
  });

  // When the player respawns, we need to update the sprite
  // Respawn is when the player is killed and then comes back to life
  connection.on('playerRespawned', (id: string, x: number, y: number) => {
    console.log('playerRespawned', id, x, y);
    upsertSprite(id, x, y);
  });

}).catch((err) => {
  console.error(err);
}
);
