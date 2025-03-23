import type { NextFunction,Request,Response } from "express"
import jwt, { JwtPayload } from "jsonwebtoken";

declare global{
    namespace Express{
      interface Request{
        userId? : string,
        user?:{
            email : string
        }
      }
    }
}

export async function authMiddleware(req:Request,res:Response,next: NextFunction) {
    try{
        const authHeader = req.headers["authorization"];
        const token = authHeader?.split(" ")[1];
        if(!token){
            res.status(401).json({message : "No token provided"});
            return ;
        }

        const decoded = jwt.verify(token,process.env.JWT_SECRET!) as JwtPayload;
        if(!decoded.userId){
            res.status(401).json({message : "Invalid token"});
            return ;
        }
        req.userId = decoded.userId;
        next();
    }catch(error){
        res.status(401).json({message : "Invalid token"});
    }
}