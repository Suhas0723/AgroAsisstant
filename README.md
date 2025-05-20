## StartUp Instructions

# Step 1:
- Follow gcloud install instructions: https://cloud.google.com/sdk/docs/install#windows
- Ensure google cloud sdk folder is located on the PATh
- Run 'gcloud init' in project folder
- Sign in using email "sampleuser785@gmail.com" with password "P@ssword456"
- Run 'gcloud auth application-default login' in project folder

# Step 2:
- Run 'pip install -r requirements.txt'

# Step 3:
- Make copy of dist.yaml under TSA-PROJECT called auth.yaml
- Fill out appropriate API keys
- auth file with keys will be provided for judges
- firebase admin keycard file will be provided for judges

# Step 4:
- Run 'python app.py'
