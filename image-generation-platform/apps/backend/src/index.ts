import express from "express"
import { Request,Response } from "express"
import {TrainModel,GenerateImage,GenerateImageFromPack} from "common/src/types"
import {prismaClient} from "db/src/index"
import cors  from "cors"
import {authMiddleware} from "./middleware"
import paymentRoutes from "./routes/payment.routes"
import { FalAIModel } from "./models/FalAIModel"
import { fal } from "@fal-ai/client"
import dotenv from "dotenv"
import {z} from "zod"
import jwt from "jsonwebtoken"
const app = express();
app.use(express.json())
app.use(cors())


const IMAGE_GEN_CREDITS = 1;
const TRAIN_MODEL_CREDITS = 20;

dotenv.config();
const falAiModel = new FalAIModel();

const Signup = z.object({
    email : z.string().email(),
    password : z.string().min(8),
    name : z.string().min(1),
})
const Signin = z.object({
    email : z.string().email(),
    password : z.string().min(8),
})

app.post("/signup",async    (req:Request,res:Response)=>{
    const parsedbody = Signup.safeParse(req.body);
    if(!parsedbody.success){
        res.status(411).json({
            message : "Inputs are Incorrect",
            error : parsedbody.error
        })
        return ;
    }   


    const user = await prismaClient.user.findUnique({
        where : {
            email : parsedbody.data.email
        }
    })
    if(user){
        res.status(411).json({
            message : "User already exists"
        })
        return ;
    }
    const User = await prismaClient.user.create({
        data : {
            email : parsedbody.data.email,
            password : parsedbody.data.password,
            name : parsedbody.data.name
        }
    })
    const userId = User.id;

    const token = jwt.sign({userId},process.env.JWT_SECRET!);
    res.json({
        token,
        user : {
            id : User.id,
            email : User.email,
            name : User.name
        }
    })  

})

app.post("/signin",async(req:Request,res:Response)=>{
    const parsedbody = Signin.safeParse(req.body);
    if(!parsedbody.success){
        res.status(411).json({
            message : "Inputs are Incorrect",
            error : parsedbody.error
        })  
        return ;
    }

    const user = await prismaClient.user.findUnique({
        where : {
            email : parsedbody.data.email,
            password : parsedbody.data.password
        }   
    })
    if(!user){
        res.status(411).json({
            message : "User not found"
        })
        return ;                
    }
    const token = jwt.sign({userId : user.id},process.env.JWT_SECRET!);
    res.json({
        token,
        user : {
            id : user.id,
            email : user.email,
            name : user.name
        }
    })
})

app.post("/ai/training",authMiddleware,async (req:Request,res:Response)=>{
    
    try{
            const parsedbody = TrainModel.safeParse(req.body);
            if(!parsedbody.success){
            res.status(411).json({
                message : "Inputs are Incorrect",
                error : parsedbody.error
            })
            return ;
        }

        const {request_id, response_url} = await falAiModel.trainModel(
            parsedbody.data.zipUrl,
            parsedbody.data.name
        )

        const data = await prismaClient.model.create({
            data: {
            name: parsedbody.data.name,
            type: parsedbody.data.type,
            age: parsedbody.data.age,
            ethnicity: parsedbody.data.ethnicity,
            eyeColor: parsedbody.data.eyeColor,
            bald: parsedbody.data.bald,
            userId: req.userId!,
            zipUrl: parsedbody.data.zipUrl,
            falAiRequestId: request_id,
            },
        });

        res.json({
            modelId : data.id
        })
    }catch(error){
        console.error("Error in training model ",error);
        res.status(500).json({
            message : "Training failed",
            error : error instanceof Error ? error.message : "Unknown error",
        })
    }

})

app.post("/ai/generate",authMiddleware,async(req:Request,res:Response)=>{
    const parsedbody = GenerateImage.safeParse(req.body)
    if(!parsedbody.success){
        res.json({
            message : "Incorrect Inputs"
        })
        return ;
    }
    const model = await prismaClient.model.findUnique({
        where : {
            id : parsedbody.data.modelId
        }
    })
    if(!model || !model.tensorPath){
        res.status(411).json({
            message : "Model not found"
        })
        return ;
    }

    const credits = await prismaClient.userCredit.findUnique({
        where : {
            userId : req.userId
        }
    })
    if((credits?.amount ?? 0)<IMAGE_GEN_CREDITS){
        res.status(411).json({
            message : "Not enough credits"
        })
        return ;
    }
    const {request_id,response_url } =await falAiModel.generateImage(
        parsedbody.data.prompt,
        model.tensorPath
    )


    const data = await prismaClient.outputImages.create({
        data : {
            prompt : parsedbody.data.prompt,
            userId : req.userId,
            modelId : parsedbody.data.modelId,
            imageUrl : "",
            falAiRequestId : request_id
        }
    })
    await prismaClient.userCredit.update({
        where : {
            userId : req.userId,
        },
        data : {
            amount : {decrement : IMAGE_GEN_CREDITS}
        }
    })
    res.json({
        imageId : data.id
    })
    
})


app.post("/pack/generate",authMiddleware,async(req:Request,res:Response)=>{
    const parsedbody = GenerateImageFromPack.safeParse(req.body);
    if(!parsedbody.success){
        res.status(411).json({
            message : "Input Incorrect"
        })
        return ;
    }
    const prompts = await prismaClient.packPrompts.findMany({
        where: {
            packId : parsedbody.data.packId,
        }
    })
    const model = await prismaClient.model.findFirst({
        where : {
            id : parsedbody.data.modelId
        }
    })
    if(!model){
        res.status(411).json({
            message : "Model not found"
        })
        return ;
    }

    const credits = await prismaClient.userCredit.findUnique({
        where : {
            userId : req.userId,
        }
    })
    if((credits?.amount ?? 0)<IMAGE_GEN_CREDITS*prompts.length){
        res.status(411).json({
            message : "Not enough credits",
        })
        return ;
    }



    let requestIds: { request_id: string }[] = await Promise.all(
        prompts.map((prompt) =>
          falAiModel.generateImage(prompt.prompt, model.tensorPath!)
        )
      );
    
      const images = await prismaClient.outputImages.createManyAndReturn({
        data: prompts.map((prompt, index) => ({
          prompt: prompt.prompt,
          userId: req.userId,
          modelId: parsedbody.data.modelId,
          imageUrl: "",
          falAiRequestId: requestIds[index].request_id,
        })),
      });
    
      await prismaClient.userCredit.update({
        where: {
          userId: req.userId!,
        },
        data: {
          amount: { decrement: IMAGE_GEN_CREDITS * prompts.length },
        },
      });
    
      res.json({
        images: images.map((image) => image.id),
      });
    });
    

app.post("/pack/bulk",async (req,res)=>{
    const packs = await prismaClient.packs.findMany({});

    res.json({
        packs,
    })
})


app.get("/image/bulk",async (req:Request,res:Response)=>{
    const ids = req.query.ids as string[];
    const limit = (req.query.limit as string) ?? "100";
    const offset = (req.query.offset as string) ?? "0";
    const imagesData = await prismaClient.outputImages.findMany({
        where : {
            id : {in : ids},
            userId : req.userId,
            status : {
                not : "Failed"
            },
        },
        orderBy : {
            createdAt : "desc"
        },
        skip : parseInt(offset),
        take : parseInt(limit),
    });
    res.json({
        images : imagesData
    })

})

app.post("/fal-ai/webhook/train",async(req,res)=>{
    const requestId = req.body.request_id as string;
    const model = await prismaClient.model.findFirst({
        where:{
            falAiRequestId : requestId
        }
    })
    if(!model){
        console.error("No model found for requestId: ",requestId);
        res.status(404).json({
            message : 'Model not found'
        })
        return ;
    }
    const result = await fal.queue.result("fal-ai/flux-lora",{
        requestId
    })

    const credits = await prismaClient.userCredit.findUnique({
        where : {
            userId : model.userId
        }
    })
    if((credits?.amount ?? 0)< TRAIN_MODEL_CREDITS){
        res.status(411).json({
            message : "Not enough credits"
        })
        return ;``
    }
    try{
        const resultData = result.data as any;
        const loraUrl = resultData.diffusers_lora_file.url;

        const { imageUrl } = await falAiModel.generateImageSync(loraUrl);
        console.log("Generated preview image: ", imageUrl);
        await prismaClient.model.updateMany({
            where:{
                falAiRequestId : requestId
            },
            data : {
                trainingStatus : "Generated",
                tensorPath : loraUrl,
                thumbnail : imageUrl
            }
        })
        await prismaClient.userCredit.update({
            where:{
                userId : model.userId,
            },
            data:{
                amount : {decrement: TRAIN_MODEL_CREDITS},
            }
        })
        res.json({
            message : "Wenhook processed successfully"
        })
    }catch(error){
        console.error("Error while processing webhook: ",error);
        res.status(500).json({
            message : "Error processing webhook",
            error : error instanceof Error ? error.message : "Unknown error",
        })
    }
})

app.get("/models",authMiddleware,async(req:Request,res:Response)=>{
    const models = await prismaClient.model.findMany({
        where:{
            OR : [{userId: req.userId},{open: true}]
        }
    })
    res.json({
        models,
    })
})

app.post("/fal-ai/webhook/image",async(req,res)=>{
    const requestId = req.body.request_id;
    if(req.body.status === "ERROR"){
        res.status(411).json({

        });
        prismaClient.outputImages.updateMany({
            where : {
                falAiRequestId : requestId
            },
            data:{
                status : "Failed",
                imageUrl : req.body.payload.images[0].url
            }
        })
        return ;
    }
    await prismaClient.outputImages.updateMany({
        where:{
            falAiRequestId : requestId
        },
        data:{
            status : "Generated",
            imageUrl : req.body.payload.images[0].url,
        }
    })
    res.json({
        message : "Webhook received"
    })
    
})

app.get("/model/status/:modelId",authMiddleware,async(req:Request,res:Response)=>{
    try{
        const modelId = req.params.modelId;
        const model = await prismaClient.model.findUnique({
            where:{
                id : modelId,
                userId : req.userId
            }
        });
        if(!model){
            res.status(404).json({
                success : false,
                message : "Model not found"
            })
            return ;
        }
        res.json({
            success : true,
            model : {
                id : model.id,
                name : model.name,
                status : model.trainingStatus,
                thumbnail : model.thumbnail,
                createdAt : model.createdAt,
                updatedAt : model.updatedAt

            },
        });
        return ;

    }catch(error){
        console.error("Error checking model status: ", error);
        res.status(500).json({
            success : false,
            message : "Failed to check model status"
        })
        return ;
    }
})

app.use("/payment",paymentRoutes);

app.listen(3000, ()=>{
    console.log("Server running on port 3000");
})