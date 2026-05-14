module.exports = {
  apps: [{
    name: 'StatusPedidos',
    script: 'server.js',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5050,
      USE_HTTPS: 'true'
    },
    env: {
      NODE_ENV: 'development',
      PORT: 5050,
      USE_HTTPS: 'false'
    }
  }]
};