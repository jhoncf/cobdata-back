const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const prismaPath = path.join(__dirname, 'node_modules', '.bin', 'prisma');
  const result = execSync(`"${prismaPath}" generate`, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: 'pipe',
    cwd: __dirname,
    env: { ...process.env, PATH: process.env.PATH },
  });
  fs.writeFileSync(path.join(__dirname, 'prisma-gen-result.txt'), 'SUCCESS:\n' + result);
} catch (e) {
  fs.writeFileSync(path.join(__dirname, 'prisma-gen-result.txt'), 'ERROR:\n' + (e.stdout || '') + '\n' + (e.stderr || '') + '\n' + e.message);
}
