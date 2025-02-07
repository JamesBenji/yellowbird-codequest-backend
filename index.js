const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cors = require("cors");
const admin = require('firebase-admin');
const { getDatabaseWithUrl } = require("firebase-admin/database");
const nodemailer = require('nodemailer');
require("dotenv").config();

const app = express();
const port = process.env.PORT || 7000;
const ORDERS_COLLECTION = "Orders";

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
  }),
});

const db = admin.firestore()
console.log({db});

// for nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// PesaPal credentials
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_ENVIRONMENT = process.env.PESAPAL_ENVIRONMENT;

const PESAPAL_API_URL =
  PESAPAL_ENVIRONMENT === "sandbox"
    ? "https://cybqa.pesapal.com/pesapalv3"
    : "https://pay.pesapal.com/v3";

app.get("/api/get-access-token", async (req, res) => {
  try {
    const response = await axios.post(
      `${PESAPAL_API_URL}/api/Auth/RequestToken`,
      {
        consumer_key:
          PESAPAL_ENVIRONMENT === "sandbox"
            ? "TDpigBOOhs+zAl8cwH2Fl82jJGyD8xev"
            : PESAPAL_CONSUMER_KEY,
        consumer_secret:
          PESAPAL_ENVIRONMENT === "sandbox"
            ? "1KpqkfsMaihIcOlhnBo/gBZ5smw="
            : PESAPAL_CONSUMER_SECRET,
      },
      {
        headers: {
          'Accept': "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    const accessToken = response.data.token;
    res.json({ accessToken });

  } catch (error) {
    console.error(
      "Error generating access token:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to generate access token" });
  }
});

app.post("/api/pesapal-ipn", async (req, res) => {
  try {
    const { orderTrackingId, status } = req.body

    let paymentStatus;
    if (status === "COMPLETED") {
      paymentStatus = "paid";
    } else if (status === "FAILED") {
      paymentStatus = "failed";
    } else {
      paymentStatus = "pending";
    }

    const orderRef = db.collection(ORDERS_COLLECTION).doc(orderTrackingId);
    await orderRef.update({ status: paymentStatus });

    if (orderStatus === "paid") {
      const orderSnapshot = await orderRef.get();
      const orderData = orderSnapshot.data();

      if (orderData) {
        const userEmail = orderData.userEmail;
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: userEmail,
          subject: "Your Order has been Confirmed",
          text: `Your order #${orderTrackingId} has been successfully paid. Thank you for shopping with us!`,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${userEmail} for Order ${orderTrackingId}`);
      }
    }

    await db.collection("Notifications").add({
      userId: orderData.userId,
      message: `Your order #${orderTrackingId} has been marked as ${orderStatus}.`,
      type: "success",
      createdAt: admin.firestore.Timestamp.now(),
    });


    res.status(200).send("IPN Received and status updated.");

  } catch (error) {
    console.error("Error processing IPN:", error);
    res.status(500).send("Error processing IPN");
  }
});

// temp switch to get from post
app.post("/api/register-ipn", async (req, res) => {
  const { accessToken } = req.body;
  
  const protocol = req.protocol; 
  const host = req.get('host');
  const serverUrl = `${protocol}://${host}`;

  const registerUrl = `${serverUrl}/api/pesapal-ipn`;

  try {
    const response = await axios.post(
      `${PESAPAL_API_URL}/api/URLSetup/RegisterIPN`,
      {
        url: registerUrl,
        ipn_notification_type: "POST",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const ipnId = response.data.ipn_id;
    res.json({ ipnId });

  } catch (error) {
    console.error(
      "Error registering IPN:",
      error.response ? error.response.data : error.message
    );
    res.status(500).json({ error: "Failed to register IPN" });
  }
});

app.post("/api/submit-order", async (req, res) => {
  const { accessToken, orderData } = req.body; 
  try {
    
    const response = await axios.post(
      `${PESAPAL_API_URL}/api/Transactions/SubmitOrderRequest`,
      orderData,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      }
    );

    const { redirect_url } = response.data;
    res.json({ redirect_url });

  } catch (error) {
    console.error(
      "Error submitting order:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to submit order" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
