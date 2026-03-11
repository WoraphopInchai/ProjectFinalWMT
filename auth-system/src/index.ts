import 'dotenv/config'
import jwt from 'jsonwebtoken'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import mysql from 'mysql2/promise'

const app = new Hono()

app.use('*', cors())

// =====================
// MYSQL CONNECTION
// =====================

let dbReady = true

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
})

// =====================
// HOME
// =====================

app.get('/', (c) => {
  return c.json({
    message: "Laundry API running"
  })
})

// =====================
// LOGIN
// =====================

app.post('/login', async (c) => {

try{

const body = await c.req.json()
let { email, password } = body

email = email.trim()
password = password.trim()

const [rows]: any = await pool.query(
"SELECT id,room,email,password,role FROM users WHERE email=? LIMIT 1",
[email]
)

const user = rows[0]

if (!user) {
return c.json({ message: 'User not found' }, 404)
}

if (user.password !== password) {
return c.json({ message: 'Invalid password' }, 401)
}

const token = jwt.sign(
{ id: user.id, email: user.email, role: user.role },
process.env.JWT_SECRET as string,
{ expiresIn: "1h" }
)

return c.json({
message: "Login success",
token,
role: user.role,
email: user.email,
room_number: user.room
})

}catch(err){
return c.json({message:"Server error"},500)
}

})

// =====================
// REGISTER
// =====================

app.post('/register', async (c) => {

try{

const body = await c.req.json()
let { room, email, password } = body

room = room.trim()
email = email.trim()
password = password.trim()

const [exist]: any = await pool.query(
"SELECT id FROM users WHERE email=?",
[email]
)

if (exist.length > 0) {
return c.json({ message: "Email already exists" }, 400)
}

await pool.query(
"INSERT INTO users (room,email,password,role) VALUES (?,?,?,?)",
[room, email, password, "user"]
)

return c.json({ message: "User created" })

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// GET USERS
// =====================

app.get('/users', async (c) => {

try{

const [rows]: any = await pool.query(
"SELECT id,room,email,role FROM users ORDER BY room ASC"
)

return c.json(rows)

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// DELETE USER
// =====================

app.delete('/users/:id', async (c) => {

try{

const id = c.req.param("id")

await pool.query(
"DELETE FROM users WHERE id=?",
[id]
)

return c.json({message:"User deleted"})

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// UPDATE USER
// =====================

app.put('/users/:id', async (c) => {

try{

const id = c.req.param("id")
const body = await c.req.json()

const { room,email,password,role } = body

await pool.query(
`UPDATE users
SET room=?,email=?,password=?,role=?
WHERE id=?`,
[room,email,password,role,id]
)

return c.json({message:"User updated"})

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// GET MACHINES
// =====================

app.get('/machines', async (c) => {

try{

const [rows]: any = await pool.query(`
SELECT 
m.id,
m.machine_number,
m.status,
m.current_user_name,
m.start_time,
m.end_time,
COUNT(q.id) as queue_count
FROM machines m
LEFT JOIN machine_queue q
ON m.machine_number = q.machine_number
GROUP BY 
m.id,
m.machine_number,
m.status,
m.current_user_name,
m.start_time,
m.end_time
ORDER BY m.machine_number ASC
`)

return c.json(rows)

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// ADD MACHINE
// =====================

app.post('/machines/add', async (c) => {

try{

const body = await c.req.json()
const { machine_number } = body

const [exist]: any = await pool.query(
"SELECT id FROM machines WHERE machine_number=?",
[machine_number]
)

if (exist.length > 0) {
return c.json({ message: "Machine number already exists" }, 400)
}

await pool.query(
"INSERT INTO machines (machine_number,status,current_user_name) VALUES (?,?,?)",
[machine_number, "available", null]
)

return c.json({ message: "Machine added" })

}catch{
return c.json({message:"Server error"},500)
}

})

// =====================
// AUTO FINISH MACHINE
// =====================

async function autoFinishMachines(){

if(!dbReady) return

try{

const [machines]: any = await pool.query(`
SELECT machine_number,end_time
FROM machines
WHERE status='in_use'
`)

const now = new Date()

for(const machine of machines){

if(!machine.end_time) continue

const end = new Date(machine.end_time)

if(now >= end){

await pool.query(
`UPDATE machines
SET status='available',
current_user_name=NULL,
start_time=NULL,
end_time=NULL
WHERE machine_number=?`,
[machine.machine_number]
)

}

}

}catch(err){
dbReady = false
console.log("Database not available, auto finish disabled")
}

}

// =====================
// START SERVER
// =====================

const port = Number(process.env.PORT) || 3000

serve({
fetch: app.fetch,
port
}, (info) => {

console.log(`Server running on port ${info.port}`)

setInterval(autoFinishMachines,5000)

})