import boto3

sts = boto3.client("sts", region_name="ap-southeast-1")

print(sts.get_caller_identity())