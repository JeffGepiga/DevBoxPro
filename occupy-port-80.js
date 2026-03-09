/**
 * occupy-port-80.js
 * Binds to port 80 to simulate it being taken.
 * Run with: node occupy-port-80.js
 * Stop with: Ctrl+C
 */
const net = require('net');

const PORT = 80;

const server = net.createServer((socket) => {
  socket.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.error('Socket error:', err.message);
    }
  });

  socket.end('Port 80 is occupied by test script.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use by something else.`);
  } else if (err.code === 'EACCES') {
    console.error(`❌ Permission denied. On Windows, try running as Administrator.`);
  } else {
    console.error('❌ Error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Port ${PORT} is now occupied. DevBox Pro will fail to bind to it.`);
  console.log(`   Press Ctrl+C to release the port.`);
});

process.on('SIGINT', () => {
  console.log('\n🔓 Releasing port 80...');
  server.close(() => {
    console.log('Done.');
    process.exit(0);
  });
});
