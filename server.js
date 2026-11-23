const { createServer } = require('node:http');
const { readFile, realpath } = require('node:fs/promises');
const path = require('node:path');

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);
const publicDirectory = path.join(__dirname, 'dist');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
};

// Kiểm tra tệp có nằm trong thư mục chứa bản chơi hay không.
function isPublicFile(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Phục vụ trang và tài nguyên tĩnh qua GET hoặc HEAD.
async function serveGame(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const filename = path.resolve(publicDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!isPublicFile(publicDirectory, filename)) {
    response.writeHead(404).end();
    return;
  }

  try {
    // Kiểm tra đường dẫn thực để liên kết tệp không trỏ ra ngoài dist/.
    const directory = await realpath(publicDirectory);
    const file = await realpath(filename);
    if (!isPublicFile(directory, file)) {
      response.writeHead(404).end();
      return;
    }

    const content = await readFile(file);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': content.length,
    }).end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const missing = ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code);
    response.writeHead(missing ? 404 : 500).end();
  }
}

const server = createServer(serveGame);
// In địa chỉ để người chơi mở game trong trình duyệt.
server.listen(port, host, () => {
  console.log(`Midnight Expressway: http://${host}:${server.address().port}/`);
});
