// Usage: npm run seed
// Adds the 18 Sales employees from the Oct 2026 attendance sheet. Safe to re-run (skips existing IDs).
// Basic and TADA start at 0: fill them in on the Employees tab before saving a month.
const { store } = require('../src/store');

const ROLES = { SO: 'Sales Officer', SM: 'Sales Manager', SR: 'Sale Representative' };
const LIST = [
  ['Bhavesh Chaudhri', 'SO'], ['Rushang Solanki', 'SO'], ['Vinod Dalal', 'SM'], ['Shubham Lakhnpal', 'SR'],
  ['Neeraj Parsai', 'SM'], ['Kamlesh Jain', 'SR'], ['Nilesh Bhatt', 'SR'], ['Ramesh Parmar', 'SR'],
  ['Rajesh Patel', 'SR'], ['Prakash Rana', 'SR'], ['Kamlesh Vishwkarma', 'SR'], ['Vikash Jain', 'SR'],
  ['Ram Shinde', 'SR'], ['Dhanraj', 'SR', '2026-10-26'], ['Rishikesh', 'SR'], ['Rakesh Shah', 'SR'],
  ['Vijay Bairwa', 'SR'], ['Mansur Namakwala', 'SR'],
];

(async () => {
  await store.init();
  const list = LIST.map(([name, role, leaving], i) => ({
    emp_code: 'DC/' + String(i + 1).padStart(4, '0'), name, designation: ROLES[role], department: 'Sales',
    joining_date: null, leaving_date: leaving || null, basic: 0, tada: 0, active: 1,
  }));
  const added = await store.seedEmployees(list);
  console.log(`Added ${added} employee(s), ${list.length - added} already existed.`);
  await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
