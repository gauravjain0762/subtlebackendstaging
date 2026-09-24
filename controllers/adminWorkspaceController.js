const Workspace = require("../models/Workspace");
const User = require("../models/User");
const Order = require("../models/Order");
const DishCompanyAssignment = require("../models/DishCompanyAssignment");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");

exports.listWorkspaces = catchAsync(async (req, res) => {
  const workspaces = await Workspace.find().sort({ createdAt: -1 });
  const codes = workspaces.map((w) => w.code);

  const [userCounts, orderCounts] = await Promise.all([
    User.aggregate([
      { $match: { workspaceCode: { $in: codes } } },
      { $group: { _id: "$workspaceCode", count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { workspaceCode: { $in: codes } } },
      { $group: { _id: "$workspaceCode", count: { $sum: 1 } } },
    ]),
  ]);

  const userCountMap = Object.fromEntries(userCounts.map((u) => [u._id, u.count]));
  const orderCountMap = Object.fromEntries(orderCounts.map((o) => [o._id, o.count]));

  const result = workspaces.map((w) => ({
    _id: w._id,
    code: w.code,
    name: w.name,
    town: w.town,
    city: w.city,
    postcode: w.postcode,
    deliveryTimes: w.deliveryTimes,
    employees: w.employees,
    premiseType: w.premiseType,
    status: w.status,
    firstName: w.contact?.firstName,
    lastName: w.contact?.lastName,
    email: w.contact?.email,
    phone: w.contact?.phone,
    countryCode: w.contact?.countryCode,
    totalUsers: userCountMap[w.code] || 0,
    totalOrders: orderCountMap[w.code] || 0,
    createdAt: w.createdAt,
  }));

  res.status(200).json({ success: true, workspaces: result });
});

exports.updateWorkspaceStatus = catchAsync(async (req, res) => {
  const { status } = req.body || {};

  if (!["active", "suspended"].includes(status)) {
    throw new AppError("Invalid status", 400);
  }

  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) {
    throw new AppError("Workspace not found", 404);
  }

  workspace.status = status;
  await workspace.save();

  res.status(200).json({
    success: true,
    workspace: { _id: workspace._id, status: workspace.status },
  });
});

exports.deleteWorkspace = catchAsync(async (req, res) => {
  const workspace = await Workspace.findByIdAndDelete(req.params.id);

  if (!workspace) {
    throw new AppError("Workspace not found", 404);
  }

  res.status(200).json({ success: true, message: "Workspace deleted" });
});

exports.deleteWorkspacePermanently = catchAsync(async (req, res) => {
  const workspaceId = req.params.id;

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    throw new AppError("Company not found", 404);
  }

  const [userCount, assignmentCount] = await Promise.all([
    User.countDocuments({ workspaceCode: workspace.code }),
    DishCompanyAssignment.countDocuments({ companyId: workspaceId }),
  ]);

  // Delete all dish assignments for this company
  await DishCompanyAssignment.deleteMany({ companyId: workspaceId });

  // Update all users belonging to this company (clear workspace reference)
  if (userCount > 0) {
    await User.updateMany(
      { workspaceCode: workspace.code },
      { $unset: { workspaceCode: "", workspaceName: "" } }
    );
  }

  // Delete the workspace
  await Workspace.findByIdAndDelete(workspaceId);

  res.status(200).json({
    success: true,
    message: `Company "${workspace.name}" permanently deleted`,
    deletedData: {
      companyId: workspace._id,
      companyName: workspace.name,
      companyCode: workspace.code,
      usersCleared: userCount,
      dishAssignmentsRemoved: assignmentCount,
    },
  });
});
