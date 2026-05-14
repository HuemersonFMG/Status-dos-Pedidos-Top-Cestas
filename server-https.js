module.exports = {
  apps: [{
    name: 'StatusPedidos',
    script: 'server.js',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5050,
      USE_HTTPS: 'true',
      BASE_URL: 'https://pedidos.topstatus.online'
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 5050,
      USE_HTTPS: 'false',
      BASE_URL: 'http://localhost:5050'
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};