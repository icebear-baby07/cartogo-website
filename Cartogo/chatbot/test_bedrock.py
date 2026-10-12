import boto3

client = boto3.client(
    "bedrock-runtime",
    region_name="ap-southeast-1"
)

response = client.converse(
    modelId="global.amazon.nova-2-lite-v1:0",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "text": "Hello! Give me a one-sentence introduction."
                }
            ]
        }
    ]
)

answer = response["output"]["message"]["content"][0]["text"]

print(answer)