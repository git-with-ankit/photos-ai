import express from "express";
const router = express.Router();
import {authMiddleware} from "../middleware";
import { PlanType } from "@prisma/client";
import { prismaClient } from "db/src";
import Stripe from "stripe";
import {
    createRazorpayOrder,
    verifyRazorpaySignature,
    createSubscriptionRecord,
    addCreditsForPlan,
    PaymentService,
} from "../services/payment";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string,{
    apiVersion : "2025-02-24.acacia",
});

router.post("/create",authMiddleware,async(req:express.Request,res:express.Response)=>{
    try{
        const {plan,isAnnual,method} = req.body;
        const userId = req.userId!;
        const userEmail = (req as any).user.email;
        console.log("Payment request received:",{
            userId,
            plan,
            isAnnual,
            method,
            headers : req.headers,
            body : req.body,
        });
        if (!userId) {
            res.status(401).json({ message: "Unauthorized" });
            return;
          }
    
          if (!userEmail) {
            res.status(400).json({ message: "User email is required" });
            return;
          }
    
          if (!plan || !method) {
            res.status(400).json({ message: "Missing required fields" });
            return;
          }
          if (method === "razorpay") {
            try {
              const order = await PaymentService.createRazorpayOrder(userId, plan);
              console.log("Razorpay order created successfully:", order);
              res.json(order);
              return;
            } catch (error) {
              console.error("Razorpay error:", error);
              res.status(500).json({
                message: "Error creating Razorpay order",
                details:
                  process.env.NODE_ENV === "development"
                    ? (error as Error).message
                    : undefined,
              });
              return;
            }
          }
    
          res.status(400).json({ message: "Invalid payment method" });
          return;
        } catch (error) {
          console.error("Payment creation error:", error);
          res.status(500).json({
            message: "Error creating payment session",
            details: error instanceof Error ? error.message : "Unknown error",
          });
          return;
    
    }
})
router.post(
    "/razorpay/verify",
    authMiddleware,
    async (req: express.Request, res: express.Response) => {
      try {
        const {
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
          plan,
          isAnnual,
        } = req.body;
  
        // Debug log
        console.log("Verification Request:", {
          userId: req.userId,
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
          signature: razorpay_signature,
          plan,
          isAnnual,
        });
  
        if (
          !razorpay_payment_id ||
          !razorpay_order_id ||
          !razorpay_signature ||
          !plan
        ) {
          res.status(400).json({
            message: "Missing required fields",
            received: {
              razorpay_payment_id,
              razorpay_order_id,
              razorpay_signature,
              plan,
            },
          });
          return;
        }
  
        try {
          const isValid = await PaymentService.verifyRazorpaySignature({
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            signature: razorpay_signature,
            plan: plan as PlanType,
            userId: req.userId!,
          });
  
          if (!isValid) {
            res.status(400).json({ message: "Invalid payment signature" });
            return;
          }
  
          // Create subscription and add credits
          const subscription = await PaymentService.createSubscriptionRecord(
            req.userId!,
            plan as PlanType,
            razorpay_payment_id,
            razorpay_order_id,
            isAnnual
          );
  
          // Get updated credits
          const userCredit = await prismaClient.userCredit.findUnique({
            where: { userId: req.userId! },
            select: { amount: true },
          });
  
          console.log("Payment successful:", {
            subscription,
            credits: userCredit?.amount,
          });
  
          res.json({
            success: true,
            credits: userCredit?.amount || 0,
            subscription,
          });
        } catch (verifyError) {
          console.error("Verification process error:", verifyError);
          res.status(500).json({
            message: "Error processing payment verification",
            details:
              verifyError instanceof Error
                ? verifyError.message
                : "Unknown error",
          });
        }
      } catch (error) {
        console.error("Route handler error:", error);
        res.status(500).json({
          message: "Error verifying payment",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
  
  router.get(
    "/subscription/:userId",
    async (req: express.Request, res: express.Response) => {
      try {
        const subscription = await prismaClient.subscription.findFirst({
          where: {
            userId: req.userId!,
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            plan: true,
            createdAt: true,
          },
        });
  
        res.json({
          subscription: subscription || null,
        });
        return;
      } catch (error) {
        console.error("Error fetching subscription:", error);
        res.status(500).json({ message: "Error fetching subscription status" });
        return;
      }
    }
  );
  
  router.get(
    "/credits/:userId",
    async (req: express.Request, res: express.Response) => {
      try {
        const userCredit = await prismaClient.userCredit.findUnique({
          where: {
            userId: req.userId,
          },
          select: {
            amount: true,
          },
        });
  
        res.json({
          credits: userCredit?.amount || 0,
        });
        return;
      } catch (error) {
        console.error("Error fetching credits:", error);
        res.status(500).json({ message: "Error fetching credits" });
        return;
      }
    }
  );
  
  // Add this route to get user credits
  router.get(
    "/credits",
    authMiddleware,
    async (req: express.Request, res: express.Response) => {
      try {
        if (!req.userId) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        }
  
        const userCredit = await prismaClient.userCredit.findUnique({
          where: {
            userId: req.userId,
          },
          select: {
            amount: true,
            updatedAt: true,
          },
        });
  
        res.json({
          credits: userCredit?.amount || 0,
          lastUpdated: userCredit?.updatedAt || null,
        });
        return;
      } catch (error) {
        console.error("Error fetching credits:", error);
        res.status(500).json({
          message: "Error fetching credits",
          details: error instanceof Error ? error.message : "Unknown error",
        });
        return;
      }
    }
  );
  router.get("/transactions", authMiddleware, async (req, res) => {
    try {
      const transactions = await prismaClient.transaction.findMany({
        where: {
          userId: req.userId!,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
  
      res.status(200).json({
        transactions,
      });
      return;
    } catch (error) {
      res.status(500).json({
        message: "Internal server error",
      });
      return;
    }
  });
  



export default router;