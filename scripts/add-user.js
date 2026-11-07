// Usage: npm run add-user -- <username> <password>
// Creates a login, or resets the password if the username already exists.
const bcrypt = require('bcryptjs');
const { store } = require('../src/store');

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error('Usage: npm run add-user -- <username> <password (min 8 characters)>');
  process.exit(1);
}
(async () => {
  await store.init();
  await store.saveUser(username, bcrypt.hashSync(password, 10));
  console.log(`Login saved for "${username}".`);
  await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
