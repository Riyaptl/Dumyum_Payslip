# Payslip app (Dumyum Chocolates)

Accounts types each month's attendance per employee. The app calculates pay, stores every month,
makes payslip PDFs in the Zoho layout, and exports any month (or all months) to Excel.

## Salary rules built in
- Per-day basic = Basic / working days (rounded to nearest rupee)
- Per-day TADA = TADA / 30 (rounded to nearest rupee)
- Basic deduction = per-day basic x (inactive + LWP + 0.5 x half days)
- TADA deduction = per-day TADA x (inactive + LWP). Half days do not touch TADA
- Penalty = per-day basic x (late x late days + uninformed x uninformed days). Penalty days are set per month on the screen (defaults in Settings)
- Gross = Basic + TADA + Incentive. Net = Gross - deductions
- PL and Reserved are stored only

Rules live in `public/calc.js` (one file, used by the screen and the PDF/Excel). Test: `npm test`.

## Run locally
Edit `.env` (username, password, port), then `npm install` and `npm start`. No terminal variables needed.
Needs Node.js 22.13 or newer (the database is Node's built-in SQLite, so nothing is compiled).
    npm install
    ADMIN_USERNAME=accounts ADMIN_PASSWORD='choose-a-strong-one' npm start
    # open http://localhost:3000

First start creates the login from those two variables. If you skip them, a random password is printed once in the console.
Add or reset a login later: `npm run add-user -- <username> <password>`

## First-time data
Run `npm run seed` once to add the 18 Sales employees (IDs DC/0001 to DC/0018, designations, Dhanraj's leaving date).
Then open the Employees tab and fill in Basic, TADA and (optionally) joining dates before saving a month.

## Free deployment (Render + MongoDB Atlas)
Render's free plan wipes its disk on every restart, so the data lives in a free MongoDB Atlas cluster instead.
When `MONGODB_URI` is set the app uses MongoDB, otherwise it uses the local SQLite file. Same screens either way.

1. **Database:** sign up at mongodb.com/atlas (free M0 cluster, no card). Create a database user (username and password).
   Under Network Access, add `0.0.0.0/0` (Render's free plan has no fixed IP). Click Connect > Drivers and copy the string.
   Put a database name before the `?`, like `...mongodb.net/payslips?retryWrites=true&w=majority`.
2. **Load the 18 employees once**, from your PC (the free Render plan has no shell):
       $env:MONGODB_URI="mongodb+srv://...your string..."   # PowerShell
       npm install
       npm run seed
3. **Code:** push this folder to a private GitHub repo (`node_modules` and `data` are already ignored).
4. **Render:** New > Web Service > pick the repo > Instance type **Free**.
   Build command `npm install`, start command `npm start`. Add environment variables:
   - `MONGODB_URI` = your Atlas string
   - `NODE_VERSION` = `22`
   - `ADMIN_USERNAME` = `accounts`
   - `ADMIN_PASSWORD` = a strong password (min 8 characters)
   - `COOKIE_SECURE` = `true`
   (A `render.yaml` is included if you prefer Blueprints.)
5. Open the Render URL, log in, fill Basic and TADA on the Employees tab.

Free plan behaviour: Render sleeps the app after 15 minutes idle, so the first load after a break takes about a minute.
Atlas M0 does not sleep and does not expire. 512 MB is far more than payroll needs.
Backup: Atlas free has no automatic backups, so use the Excel export "all months" monthly as your safety copy.

## Run on your own server instead
`npm install --omit=dev`, then `PORT=3100 COOKIE_SECURE=true ADMIN_USERNAME=... ADMIN_PASSWORD=... node src/server.js` behind any HTTPS reverse proxy.
Without `MONGODB_URI`, all data is one file, `data/payroll.db`. Back it up daily.

## Notes
- Basic and TADA are edited only on the Employees tab and shown read-only in Monthly Entry. A month keeps the Basic/TADA it was first saved with, so later increments never change old payslips. To update a saved month on purpose, open it and click "Refresh rates from Employees".
- An employee with saved months cannot be deleted, mark them Inactive instead.
