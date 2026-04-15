
// Force Node to use IPv4
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require("express");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");
if (process.env.NODE_ENV !== "production") {
  require('dotenv').config();
}

const app = express();

app.use(cors());
app.use(bodyParser.json());

// ✅ Serve frontend files (AFTER app is created)
app.use(express.static(path.join(__dirname, "../")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../Login/login2.html"));
});

// ⚠️ Replace with your Gmail + App Password
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
   auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
},
  connectionTimeout: 60000,   // 🔥 add this
  greetingTimeout: 60000,
  socketTimeout: 60000,
    tls: { rejectUnauthorized: false }
});

const activeRequests = new Map();

// OTP store (email → OTP)
const otpStore = new Map();

// MySQL connection config
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectTimeout: 60000,
    ssl: {
        rejectUnauthorized: false
    }
};

let db;

// Initialize database & users table
async function initDB() {
    try {
        // Connect to MySQL server (without DB first)
        const conn = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password
        });

        // Create database if not exists
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);

        // Connect to the database
       db = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
        // Create users table if not exists
        const createTableQuery = `
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,

    accent_color VARCHAR(20) DEFAULT 'blue',
    pinned TEXT,
    recent TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;
        await db.query(createTableQuery);
        await db.query(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(100) NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            `);

            // Create circuits table if not exists
            const createCircuitsTable = `
            CREATE TABLE IF NOT EXISTS circuits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(100),
                name VARCHAR(100),
                circuit_data LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            `;
            
            await db.query(createCircuitsTable);
        console.log("Database & Users table ready ✅");
    } catch (err) {
        console.error("DB Init Error:", err);
       
    }
}

// Generate 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ================= SIGNUP → SEND OTP =================
app.post("/signup", async (req, res) => {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
        return res.status(400).json({ success: false, message: "All fields required" });
    }

    try {
        const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [email]);

        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: "Email already registered" });
        }

        await db.query(
            "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
            [name, email, password]
        );

        res.json({ success: true, message: "Signup successful ✅" });

    } catch (err) {
        console.error("Signup Error:", err);
        res.status(500).json({ success: false, message: "Server error ❌" });
    }
});
// ================= VERIFY OTP =================
app.post("/verify-otp", async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).send({ success: false, message: "Email & OTP required" });

    try {
        const record = otpStore.get(email);

if (!record) {
    return res.status(400).send({ success: false, message: "OTP expired" });
}

// expiry (5 min)
if (Date.now() - record.createdAt > 5 * 60 * 1000) {
    otpStore.delete(email);
    return res.status(400).send({ success: false, message: "OTP expired" });
}

if (record.otp !== otp) {
    return res.status(400).send({ success: false, message: "Invalid OTP" });
}

        // Hash the password before storing
        const hashedPassword = await bcrypt.hash(record.password, 10);

        // Insert user into DB
        await db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [record.name, email, hashedPassword]);

        otpStore.delete(email); // remove from store
        res.send({ success: true, message: "Signup complete ✅" });
    } catch (err) {
        console.error("OTP Verify Error:", err);
        res.status(500).send({ success: false, message: "Server error ❌" });
    }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await db.execute(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (rows.length === 0) {
            return res.json({ success: false, message: "User not found" });
        }

        const user = rows[0];

        // ✅ Compare encrypted password properly
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({ success: false, message: "Wrong password" });
        }

        // ✅ Send name back to frontend
        res.json({
            success: true,
            name: user.name,
            email: user.email
        });

    } catch (err) {
        console.log(err);
        res.status(500).send("Server error");
    }
});

// ============== User name for main dashboard
app.post("/get-user", async (req, res) => {
    console.log('Hitttttt')
    const { email } = req.body;

    if (!email) {
        return res.json({ success: false, message: "Email required" });
    }

    try {
        const [rows] = await db.query(
`SELECT name, email, accent_color, pinned, recent 
 FROM users 
 WHERE email = ?`,
[email]
);

        if (rows.length === 0) {
            return res.json({ success: false, message: "User not found" });
        }
        console.log('success')

        res.json({
    success: true,
    name: rows[0].name,
    email: rows[0].email,
    accentColor: rows[0].accent_color,
    pinned: rows[0].pinned,
    recent: rows[0].recent
});

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// =================== update name 
app.post("/update-name", async (req, res) => {
    const { email, newName } = req.body;

    if (!email || !newName) {
        return res.json({ success: false, message: "Missing data" });
    }

    try {
        await db.query(
            "UPDATE users SET name = ? WHERE email = ?",
            [newName, email]
        );

        res.json({ success: true, message: "Name updated" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

//============== Settings
app.post("/save-settings", async (req, res) => {
    const { email, darkMode, accentColor, pinned, recent } = req.body;

    if (!email) {
        return res.json({ success: false });
    }

    try {
        await db.query(
            `UPDATE users 
             SET accent_color = ?, 
                 pinned = ?, 
                 recent = ?
             WHERE email = ?`,
            [
                accentColor,
                JSON.stringify(pinned),
                JSON.stringify(recent),
                email
            ]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});
// ================= CHANGE PASSWORD =================
app.post("/change-password", async (req, res) => {

    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.json({ success: false, message: "Missing data" });
    }

    try {

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query(
            "UPDATE users SET password = ? WHERE email = ?",
            [hashedPassword, email]
        );

        res.json({ success: true, message: "Password updated" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }

});

// ================= SUBMIT FEEDBACK =================
app.post("/submit-feedback", async (req, res) => {

const { email, message } = req.body;

if(!email || !message){
return res.json({ success:false, message:"Missing data" });
}

try{

await db.query(
"INSERT INTO feedback (email, message) VALUES (?, ?)",
[email, message]
);

res.json({ success:true });
console.log('Feedback success')

}catch(err){

console.error(err);
res.status(500).json({ success:false });

}

});

app.post("/save-circuit", async (req,res)=>{

    const { email, name, data } = req.body;
    
    await db.query(
    "INSERT INTO circuits (email,name,circuit_data) VALUES (?,?,?)",
    [email,name,JSON.stringify(data)]
    );
    
    res.json({success:true});
    
});

app.post("/get-circuits", async (req,res)=>{

    const { email } = req.body;
    
    const [rows] = await db.query(
    "SELECT id,name,created_at FROM circuits WHERE email=? ORDER BY created_at DESC",
    [email]
    );
    
    res.json({
    success:true,
    circuits:rows
    });
    
});

app.post("/load-circuit", async (req,res)=>{

    const { id } = req.body;
    
    const [rows] = await db.query(
    "SELECT circuit_data FROM circuits WHERE id=?",
    [id]
    );
    
    res.json({
    success:true,
    data:JSON.parse(rows[0].circuit_data)
    });
    
});


// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await initDB();
    console.log("Database connected ✅");
  } catch (err) {
    console.error("DB failed but server still running ❌");
  }
});
