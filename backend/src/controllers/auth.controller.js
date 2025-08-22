import { generateToken } from "../lib/utils.js";
import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import cloudinary from "../lib/cloudinary.js";
import crypto from "crypto";
import nodemailer from "nodemailer";

export const signup = async (req, res) => {
  const { fullName, email, password } = req.body;
  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email });

    if (user) return res.status(400).json({ message: "Email already exists" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      fullName,
      email,
      password: hashedPassword,
    });

    if (newUser) {
     
      generateToken(newUser._id, res);
      await newUser.save();

      res.status(201).json({
        _id: newUser._id,
        fullName: newUser.fullName,
        email: newUser.email,
        profilePic: newUser.profilePic,
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    console.log("Error in signup controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    generateToken(user._id, res);

    res.status(200).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      profilePic: user.profilePic,
    });
  } catch (error) {
    console.log("Error in login controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const logout = (req, res) => {
  try {
    res.cookie("jwt", "", { maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.log("Error in logout controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { profilePic } = req.body;
    const userId = req.user._id;

    console.log("📸 Profile update request for user:", userId);
    console.log("📝 Image data length:", profilePic?.length);

    if (!profilePic) {
      return res.status(400).json({ message: "Profile pic is required" });
    }

    console.log("☁️ Uploading to Cloudinary...");
    const uploadResponse = await cloudinary.uploader.upload(profilePic);
    console.log("✅ Cloudinary upload success:", uploadResponse.secure_url);

    console.log("💾 Updating user in database...");
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePic: uploadResponse.secure_url },
      { new: true }
    );
    console.log("✅ Database update success:", updatedUser.profilePic);

    res.status(200).json(updatedUser);
  } catch (error) {
    console.log("❌ Error in update profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const checkAuth = (req, res) => {
  try {
    res.status(200).json(req.user);
  } catch (error) {
    console.log("Error in checkAuth controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  
  try {
    console.log("🔐 Forgot password request for email:", email);
    
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    console.log("👤 User found:", user ? "Yes" : "No");
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

   
    if (!process.env.FRONTEND_URL) {
      console.error("❌ FRONTEND_URL environment variable not set");
      return res.status(500).json({ message: "Server configuration error" });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("❌ Email credentials not configured");
      return res.status(500).json({ message: "Email service not configured" });
    }


    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    console.log("🔑 Reset token generated");

  
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();
    console.log("💾 User updated with reset token");


    const resetURL = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    console.log("📧 Sending reset email to:", email);
    console.log("🔗 Reset URL:", resetURL);
    
    await sendResetEmail(user.email, resetURL);
    console.log("✅ Reset email sent successfully");

    res.status(200).json({ message: 'Password reset email sent successfully' });
  } catch (error) {
    console.log("❌ Error in forgotPassword controller:", error);
    
    // Clear any saved reset token if email sending failed
    if (error.code === 'EAUTH' || error.code === 'ENOTFOUND') {
      console.log("🧹 Clearing reset token due to email error");
      try {
        const user = await User.findOne({ email });
        if (user) {
          user.resetPasswordToken = null;
          user.resetPasswordExpires = null;
          await user.save();
        }
      } catch (cleanupError) {
        console.log("Error cleaning up reset token:", cleanupError.message);
      }
    }
    
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    console.log("🔄 Password reset attempt with token");
    
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }


    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    console.log("👤 Valid user found for reset:", user ? "Yes" : "No");

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }


    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    console.log("✅ Password reset successful for user:", user.email);
    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.log("❌ Error in resetPassword controller:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


const sendResetEmail = async (email, resetURL) => {
  try {
    console.log("📮 Creating email transporter...");
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    console.log("🔍 Verifying email transporter...");
    await transporter.verify();
    console.log("✅ Email transporter verified");

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request - Chat App',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
          <p>You requested a password reset for your chat app account.</p>
          <p>Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetURL}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 10 minutes for security reasons.
          </p>
          <p style="color: #666; font-size: 14px;">
            If you didn't request this reset, please ignore this email.
          </p>
        </div>
      `
    };

    console.log("📤 Sending email...");
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", info.messageId);
    
  } catch (error) {
    console.error("❌ Email sending failed:");
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    
    if (error.code === 'EAUTH') {
      console.error("🔑 Authentication failed - check your Gmail app password");
    } else if (error.code === 'ENOTFOUND') {
      console.error("🌐 Network error - check your internet connection");
    } else if (error.code === 'ECONNECTION') {
      console.error("🔌 Connection failed to Gmail servers");
    }
    
    throw error; 
  }
};

export const testEmailConfig = async (req, res) => {
  try {
    console.log("🧪 Testing email configuration...");
    
    // Check environment variables
    console.log("📧 EMAIL_USER:", process.env.EMAIL_USER);
    console.log("🌐 FRONTEND_URL:", process.env.FRONTEND_URL);
    console.log("🔑 EMAIL_PASS configured:", !!process.env.EMAIL_PASS);
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ 
        error: "Email credentials not configured",
        details: {
          emailUser: !!process.env.EMAIL_USER,
          emailPass: !!process.env.EMAIL_PASS,
          frontendUrl: !!process.env.FRONTEND_URL
        }
      });
    }

    // FIXED: Changed from createTransporter to createTransport
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Test connection
    console.log("🔍 Verifying transporter...");
    await transporter.verify();
    console.log("✅ Email transporter verified successfully");

    // Send test email
    const testEmail = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to yourself for testing
      subject: 'Test Email - Configuration Working',
      text: 'This is a test email to verify your email configuration is working properly.'
    };

    console.log("📤 Sending test email...");
    const info = await transporter.sendMail(testEmail);
    console.log("✅ Test email sent:", info.messageId);

    res.status(200).json({ 
      message: "Email configuration is working correctly!",
      messageId: info.messageId
    });

  } catch (error) {
    console.error("❌ Email test failed:", error);
    
    let errorMessage = "Email configuration test failed";
    
    if (error.code === 'EAUTH') {
      errorMessage = "Authentication failed - check your email credentials";
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = "Network error - check your internet connection";
    } else if (error.code === 'ECONNECTION') {
      errorMessage = "Connection failed to email server";
    }

    res.status(500).json({ 
      error: errorMessage,
      details: error.message,
      code: error.code
    });
  }
};