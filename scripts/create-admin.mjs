// Run from the dashboard folder: node scripts/create-admin.mjs
const res = await fetch('https://atlas-dashboard-psi.vercel.app/api/admin/create-user', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer atlas-dashboard-secret-2026'
  },
  body: JSON.stringify({
    username: 'admin',
    password: 'Manifest777$',
    clientSlug: 'admin',
    name: 'Erik (Admin)'
  })
});
const data = await res.json();
console.log(res.status, JSON.stringify(data, null, 2));
