var socket = socketCluster.connect({
  codecEngine: scCodecMinBin
});

window.onload = function () {

  //  Note that this html file is set to pull down Phaser from our public/ directory.
  //  Although it will work fine with this tutorial, it's almost certainly not the most current version.
  //  Be sure to replace it with an updated version before you start experimenting with adding your own code.

  var game, playerId, player;
  users = {};
  coins = {};

  var WORLD_WIDTH;
  var WORLD_HEIGHT;
  var WORLD_COLS;
  var WORLD_ROWS;
  var WORLD_CELL_WIDTH;
  var WORLD_CELL_HEIGHT;
  var PLAYER_LINE_OF_SIGHT = Math.round(window.innerWidth);
  var PLAYER_INACTIVITY_TIMEOUT = 700;
  var USER_INPUT_INTERVAL = 20;
  var COIN_INACTIVITY_TIMEOUT = 2200;
  var ENVIRONMENT;
  var SERVER_WORKER_ID;

  var youTextures = {
    up: 'img/io-gubbe2.png',
    left: 'img/io-gubbe2.png',
    right: 'img/io-gubbe2.png',
    down: 'img/io-gubbe2.png'
  };

  var othersTextures = {
    up: 'img/others-back.gif',
    left: 'img/others-side-left.gif',
    right: 'img/others-side-right.gif',
    down: 'img/others-front.gif'
  };

  var botTextures = {
    up: 'img/bot-back.gif',
    left: 'img/bot-side-left.gif',
    right: 'img/bot-side-right.gif',
    down: 'img/bot-front.gif'
  };

  // Map the score value to the texture.
  var grassTextures = {
    1: 'img/grass-1.gif',
    2: 'img/grass-2.gif',
    3: 'img/grass-3.gif',
    4: 'img/grass-4.gif'
  };

  // 1 means no smoothing. 0.1 is quite smooth.
  var CAMERA_SMOOTHING = 1;
  var BACKGROUND_TEXTURE = 'img/background-texture.png';

  socket.emit('getWorldInfo', null, function (err, data) {
    WORLD_WIDTH = data.width;
    WORLD_HEIGHT = data.height;
    WORLD_COLS = data.cols;
    WORLD_ROWS = data.rows;
    WORLD_CELL_WIDTH = data.cellWidth;
    WORLD_CELL_HEIGHT = data.cellHeight;
    WORLD_CELL_OVERLAP_DISTANCE = data.cellOverlapDistance;
    SERVER_WORKER_ID = data.serverWorkerId;
    ENVIRONMENT = data.environment;

    channelGrid = new ChannelGrid({
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      rows: WORLD_ROWS,
      cols: WORLD_COLS,
      cellOverlapDistance: WORLD_CELL_OVERLAP_DISTANCE,
      exchange: socket
    });

    game = new Phaser.Game('100', '100', Phaser.AUTO, '', {
      preload: preload,
      create: create,
      render: render,
      update: update
    });
  });

  function preload() {
    keys = {
      up: game.input.keyboard.addKey(Phaser.Keyboard.UP),
      down: game.input.keyboard.addKey(Phaser.Keyboard.DOWN),
      right: game.input.keyboard.addKey(Phaser.Keyboard.RIGHT),
      left: game.input.keyboard.addKey(Phaser.Keyboard.LEFT)
    };

    game.load.image('background', BACKGROUND_TEXTURE);

    game.load.image('you-up', youTextures.up);
    game.load.image('you-down', youTextures.down);
    game.load.image('you-right', youTextures.right);
    game.load.image('you-left', youTextures.left);

    game.load.image('others-up', othersTextures.up);
    game.load.image('others-down', othersTextures.down);
    game.load.image('others-right', othersTextures.right);
    game.load.image('others-left', othersTextures.left);

    game.load.image('bot-up', botTextures.up);
    game.load.image('bot-down', botTextures.down);
    game.load.image('bot-right', botTextures.right);
    game.load.image('bot-left', botTextures.left);

    game.load.image('grass-1', grassTextures[1]);
    game.load.image('grass-2', grassTextures[2]);
    game.load.image('grass-3', grassTextures[3]);
    game.load.image('grass-4', grassTextures[4]);
  }

  function handleCellData(stateList) {
    stateList.forEach(function (state) {
      if (state.type == 'player') {
        updateUser(state);
      } else if (state.type == 'coin') {
        if (state.delete) {
          removeCoin(state);
        } else {
          renderCoin(state);
        }
      }
    });
    updatePlayerZIndexes();
  }

  var watchingCells = {};

  /*
    Data channels within our game are divided a grids and we only watch the cells
    which are within our player's line of sight.
    As the player moves around the game world, we need to keep updating the cell subscriptions.
  */
  function updateCellWatchers(playerData, channelName, handler) {
    var options = {
      lineOfSight: PLAYER_LINE_OF_SIGHT
    };
    channelGrid.updateCellWatchers(playerData, channelName, options, handler);
  }

  function updateUserGraphics(user) {
    user.sprite.x = user.x;
    user.sprite.y = user.y;

    if (!user.direction) {
      user.direction = 'down';
    }
    user.sprite.loadTexture(user.texturePrefix + '-' + user.direction);

    user.label.alignTo(user.sprite, Phaser.BOTTOM_CENTER, 0, 10);
  }

  function moveUser(userId, x, y) {
    var user = users[userId];
    user.x = x;
    user.y = y;
    updateUserGraphics(user);
    user.clientProcessed = Date.now();

    if (user.id == playerId) {
      updateCellWatchers(user, 'cell-data', handleCellData);
    }
  }

  function removeUser(userData) {
    var user = users[userData.id];
    if (user) {
      user.sprite.destroy();
      user.label.destroy();
      delete users[userData.id];
    }
  }

  function createTexturedSprite(options) {
    var sprite = game.add.sprite(0, 0, options.texture);
    sprite.anchor.setTo(0.5);

    return sprite;
  }

  function createUserSprite(userData) {
    var user = {};
    users[userData.id] = user;
    user.id = userData.id;
    user.swid = userData.swid;
    user.name = userData.name;

    var textStyle = {
      font: '16px Arial',
      fill: '#666666',
      align: 'center'
    };

    user.label = game.add.text(0, 0, user.name, textStyle);
    user.label.anchor.set(0.5);

    var sprite;

    if (userData.id == playerId) {
      sprite = createTexturedSprite({
        texture: 'you-down'
      });
      user.texturePrefix = 'you';
    } else if (userData.subtype == 'bot') {
      sprite = createTexturedSprite({
        texture: 'bot-down'
      });
      user.texturePrefix = 'bot';
    } else {
      sprite = createTexturedSprite({
        texture: 'others-down'
      });
      user.texturePrefix = 'others';
    }

    user.score = userData.score;
    user.sprite = sprite;

    user.sprite.width = Math.round(userData.diam * 2);
    user.sprite.height = user.sprite.width * 0.8;
    user.diam = user.sprite.width;

    moveUser(userData.id, userData.x, userData.y);

    if (userData.id == playerId) {
      player = user;
      game.camera.setSize(window.innerWidth, window.innerHeight);
      game.camera.follow(user.sprite, null, CAMERA_SMOOTHING, CAMERA_SMOOTHING);
    }
  }

  function updatePlayerZIndexes() {
    var usersArray = [];
    for (var i in users) {
      if (users.hasOwnProperty(i)) {
        usersArray.push(users[i]);
      }
    }
    usersArray.sort(function (a, b) {
      if (a.y < b.y) {
        return -1;
      }
      if (a.y > b.y) {
        return 1;
      }
      return 0;
    });
    usersArray.forEach(function (user) {
      user.label.bringToTop();
      user.sprite.bringToTop();
    });
  }

  function updateUser(userData) {
    var user = users[userData.id];
    if (user) {
      user.score = userData.score;
      user.direction = userData.direction;
      moveUser(userData.id, userData.x, userData.y);
    } else {
      createUserSprite(userData);
    }
  }

  function removeCoin(coinData) {
    var coinToRemove = coins[coinData.id];
    if (coinToRemove) {
      coinToRemove.sprite.destroy();
      delete coins[coinToRemove.id];
    }
  }

  function renderCoin(coinData) {
    if (coins[coinData.id]) {
      coins[coinData.id].clientProcessed = Date.now();
    } else {
      var coin = coinData;
      coins[coinData.id] = coin;
      coin.sprite = createTexturedSprite({
        texture: 'grass-' + (coinData.t || '1')
      });
      coin.sprite.x = coinData.x;
      coin.sprite.y = coinData.y;
      coin.clientProcessed = Date.now();
    }
  }

  function create() {
    background = game.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'background');
    game.time.advancedTiming = true;
    game.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Generate a random name for the user.
    var playerName = 'user-' + Math.round(Math.random() * 10000);

    function joinWorld() {
      socket.emit('join', {
        name: playerName,
      }, function (err, playerData) {
        playerId = playerData.id;
        updateCellWatchers(playerData, 'cell-data', handleCellData);
      });
    }

    function removeAllUserSprites() {
      for (var i in users) {
        if (users.hasOwnProperty(i)) {
          removeUser(users[i]);
        }
      }
    }

    if (socket.state == 'open') {
      joinWorld();
    }
    // For reconnect
    socket.on('connect', joinWorld);
    socket.on('disconnect', removeAllUserSprites);
  }

  var lastActionTime = 0;
  var playerOp = {};
  function update() {
    if (keys.up.isDown) {
      changeDirection('u');
    }
    if (keys.down.isDown) {
      changeDirection('d');
    }
    if (keys.right.isDown) {
      changeDirection('r');
    }
    if (keys.left.isDown) {
      changeDirection('l');
    }
    var isEmpty = (Object.keys(playerOp).length === 0 &&
                   playerOp.constructor === Object);
    if (!isEmpty && Date.now() - lastActionTime >= USER_INPUT_INTERVAL) {
      lastActionTime = Date.now();
      // Send the player operations for the server to process.
      socket.emit('action', playerOp);
    }
    game.input.keyboard.reset(true);
  }

  const opposites = {
    u: 'd',
    d: 'u',
    l: 'r',
    r: 'l'
  };

  function changeDirection(direction) {
    if (playerOp[direction] === 1) {
      // Player is already moving in the wanted direction. Make it
      // move ONLY in that direction, i.e. not diagonally.
      for (var d in opposites) {
        if (d !== direction) {
          delete playerOp[d];
        }
      }
    }
    if (!playerOp[opposites[direction]]) {
      playerOp[direction] = 1;
    }
    delete playerOp[opposites[direction]];
    for (id in users) {
      var user = users[id];
      if (user.texturePrefix === "you") {
        if (playerOp.r === 1) {
          user.sprite.angle = 90;
          if (playerOp.u === 1) {
            user.sprite.angle -= 45;
          } else if (playerOp.d === 1) {
            user.sprite.angle += 45;
          }
        } else if (playerOp.u === 1) {
          user.sprite.angle = 0;
          if (playerOp.l === 1) {
            user.sprite.angle -= 45;
          } else if (playerOp.r === 1) {
            user.sprite.angle += 45;
          }
        } else if (playerOp.l === 1) {
          user.sprite.angle = 270;
          if (playerOp.u === 1) {
            user.sprite.angle += 45;
          } else if (playerOp.d === 1) {
            user.sprite.angle -= 45;
          }
        } else if (playerOp.d === 1) {
          user.sprite.angle = 180;
          if (playerOp.l === 1) {
            user.sprite.angle += 45;
          } else if (playerOp.r === 1) {
            user.sprite.angle -= 45;
          }
        }
      }
    }
  }

  function render() {
    var now = Date.now();

    if (ENVIRONMENT == 'dev') {
      game.debug.text('FPS:   ' + game.time.fps, 2, 14, "#00FF00");
      if (player) {
        game.debug.text('Score: ' + player.score, 2, 30, "#00FF00");
      }
    }

    for (var i in users) {
      if (users.hasOwnProperty(i)) {
        var curUser = users[i];
        if (now - curUser.clientProcessed > PLAYER_INACTIVITY_TIMEOUT) {
          removeUser(curUser);
        }
      }
    }

    for (var j in coins) {
      if (coins.hasOwnProperty(j)) {
        var curCoin = coins[j];
        if (now - curCoin.clientProcessed > COIN_INACTIVITY_TIMEOUT) {
          removeCoin(curCoin);
        }
      }
    }
  }
};
