import express from "express"
import {TrainModel,GenerateImage,GenerateImageFromPack} from "common/src/types"
import {prismaClient} from "db/src/index"
const app = express();


app.post("/ai/training",(req,res)=>{
    
})

app.post("/ai/generate",(req,res)=>{
    
})


app.post("/pack/generate",(req,res)=>{
    
})

app.post("/pack/bulk",(req,res)=>{
    
})


app.post("/image",(req,res)=>{

})


app.listen(3000, ()=>{
    console.log("Server running on port 3000");
})