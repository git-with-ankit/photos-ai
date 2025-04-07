import { cookies } from "next/headers";
import * as jwt from "jsonwebtoken";

export default async function checkAuth() {
    try {
        const cookieStore = await cookies();
        const authToken = cookieStore.get("auth-token")?.value;
        
        if (!authToken) {
            return false;
        }

        const decoded = jwt.verify(authToken, process.env.JWT_SECRET!);
        if(decoded){
            return authToken
        }else{
            return undefined
        }
    } catch (error) {
        console.error("Token verification failed:", error);
        return undefined;
    }
} 