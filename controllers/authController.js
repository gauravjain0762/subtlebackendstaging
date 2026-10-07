const User = require("../models/User");
const Workspace = require("../models/Workspace");
const PasswordResetCode = require("../models/PasswordResetCode");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { isValidEmail } = require("../utils/validators");
const generateToken = require("../utils/generateToken");
const { generateResetCode, hashResetCode, compareResetCode, RESET_CODE_TTL_SECONDS } = require("../utils/resetCode");
const { sendPasswordResetEmail } = require("../services/emailService");

exports.register = catchAsync(async (req, res) => {
  const { firstName, lastName, email, workspaceCode, password, confirmPassword } = req.body || {};

  if (!firstName || !lastName || !isValidEmail(email) || !workspaceCode || !password || !confirmPassword) {
    throw new AppError(
      "firstName, lastName, email, workspaceCode, password and confirmPassword are required",
      400
    );
  }

  if (password !== confirmPassword) {
    throw new AppError("Passwords do not match", 400);
  }

  if (password.length < 6) {
    throw new AppError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const workspace = await Workspace.findOne({
    code: workspaceCode.trim().toUpperCase(),
    status: "active",
  });
  if (!workspace) {
    throw new AppError("Invalid or inactive workspace code", 400);
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError("Email already registered", 400);
  }

  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    password,
    workspaceCode: workspace.code,
    workspaceName: workspace.name,
    workspaceAddress: workspace.address1,
    workspaceCity: workspace.city,
    workspaceCounty: workspace.county,
    workspacePostcode: workspace.postcode,
    workspaceDeliveryTimes: workspace.deliveryTimes,
    premiseType: workspace.premiseType,
  });

  const token = generateToken(user._id);

  const userObj = user.toObject();
  userObj.premiseType = workspace.premiseType;

  res.status(201).json({
    success: true,
    token,
    user: userObj,
  });
});

exports.login = catchAsync(async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || !password) {
    throw new AppError("Invalid email or password", 401);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.status === "blocked") {
    throw new AppError("Your account has been blocked. Please contact support.", 403);
  }

  const token = generateToken(user._id);

  const userObj = user.toObject();
  const workspace = await Workspace.findOne({ code: user.workspaceCode });
  if (workspace) {
    userObj.premiseType = workspace.premiseType;
    userObj.workspaceStatus = workspace.status;
  }

  res.status(200).json({
    success: true,
    token,
    user: userObj,
  });
});

exports.getMe = catchAsync(async (req, res) => {
  const userObj = req.user.toObject ? req.user.toObject() : req.user;
  const workspace = await Workspace.findOne({ code: req.user.workspaceCode });
  if (workspace) {
    userObj.premiseType = workspace.premiseType;
    userObj.workspaceStatus = workspace.status;
  }

  res.status(200).json({
    success: true,
    user: userObj,
  });
});

exports.forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body || {};

  if (isValidEmail(email)) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (user) {
      const code = generateResetCode();
      const codeHash = await hashResetCode(code);
      const expiresAt = new Date(Date.now() + RESET_CODE_TTL_SECONDS * 1000);

      await PasswordResetCode.deleteMany({ email: normalizedEmail });
      await PasswordResetCode.create({ email: normalizedEmail, codeHash, expiresAt });

      await sendPasswordResetEmail(normalizedEmail, code);
    }
  }

  res.status(200).json({ success: true });
});

exports.resetPassword = catchAsync(async (req, res) => {
  const { email, otp, newPassword } = req.body || {};

  if (!isValidEmail(email) || !otp || !newPassword) {
    throw new AppError("Invalid or expired code", 400);
  }

  if (newPassword.length < 6) {
    throw new AppError("Password must be at least 6 characters", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  const resetCode = await PasswordResetCode.findOne({ email: normalizedEmail }).sort({ createdAt: -1 });
  if (!resetCode || resetCode.expiresAt < new Date()) {
    throw new AppError("Invalid or expired code", 400);
  }

  const isMatch = await compareResetCode(String(otp), resetCode.codeHash);
  if (!isMatch) {
    throw new AppError("Invalid or expired code", 400);
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new AppError("Invalid or expired code", 400);
  }

  user.password = newPassword;
  await user.save();

  await PasswordResetCode.deleteMany({ email: normalizedEmail });

  res.status(200).json({ success: true });
});
