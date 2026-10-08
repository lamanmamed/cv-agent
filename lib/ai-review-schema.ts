const stringJSON={type:"string"};
const citationJSON={type:"object",additionalProperties:false,required:["sourceId","quote"],properties:{sourceId:stringJSON,quote:stringJSON}};
const editJSON={type:"object",additionalProperties:false,required:["blockId","original","suggested","reason","jobRequirement","citations"],properties:{blockId:stringJSON,original:stringJSON,suggested:stringJSON,reason:stringJSON,jobRequirement:stringJSON,citations:{type:"array",items:citationJSON}}};
const commentJSON={type:"object",additionalProperties:false,required:["blockId","kind","text"],properties:{blockId:stringJSON,kind:{type:"string",enum:["question","observation","strength"]},text:stringJSON}};
const insightJSON={type:"object",additionalProperties:false,required:["point","sourceId","quote"],properties:{point:stringJSON,sourceId:stringJSON,quote:stringJSON}};
export const outputJSON={type:"object",additionalProperties:false,required:["suggestions","comments","insights"],properties:{suggestions:{type:"array",items:editJSON},comments:{type:"array",items:commentJSON},insights:{type:"array",items:insightJSON}}};
