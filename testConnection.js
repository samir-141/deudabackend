import { connectDB } from './src/db.js';

(async () => {
  await connectDB();
})();
