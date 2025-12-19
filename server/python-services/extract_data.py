# extract_data.py - Script to read full data from Excel/CSV file content passed via stdin.
import pandas as pd
import sys
import json
import os
from io import BytesIO
from typing import Dict, Any, List

def extract_full_data(file_path: str) -> Dict[str, Any]:
    """
    Extract all data rows from the file specified by file_path.
    The file type is determined from the file path argument.

    Args:
        file_path: The absolute path to the file (.xlsx, .xls, .csv) with the correct extension.

    Returns:
        A dictionary containing the results:
        - {"success": True, "headers": List[str], "data": List[Dict[str, Any]], "status": 200} on success.
        - {"success": False, "error": str, "status": int} on failure.
    """
    
    sys.stderr.write(f"Python: Script started for file at path: {file_path}\n")
    
    try:
        # Determine file extension from the file path argument
        file_ext = os.path.splitext(file_path)[1].lower()
        
        df = None
        # Read file into DataFrame based on extension
        if file_ext in ['.xlsx', '.xls']:
            # Read all rows, assuming header is row 0 (index 0)
            df = pd.read_excel(file_path, sheet_name=0, header=0) # Reads from file path
        elif file_ext == '.csv':
            # CSV reader
            try:
                df = pd.read_csv(file_path, header=0) # Reads from file path
            except Exception as csv_error:
                sys.stderr.write(f"Python: CSV read failed with default, trying 'latin-1'. Error: {csv_error}\n")
                df = pd.read_csv(file_path, header=0, encoding='latin-1') # Reads from file path
        else:
            # If the extension is not recognized (client-side validation should prevent this)
            sys.stderr.write(f"Python: Unrecognized file extension ({file_ext}). Attempting to read as CSV directly from path.\n")
            df = pd.read_csv(file_path, header=0)

        # Ensure DataFrame was loaded before proceeding
        if df is None:
             raise ValueError("File content could not be interpreted by pandas.")
             
        # 1. Clean Headers: Convert to string, strip whitespace, replace invalid characters
        original_headers = df.columns.tolist()
        cleaned_headers = []
        header_map = {}
        for header in original_headers:
            cleaned = str(header).strip()
            # Basic cleanup: remove special characters, replace spaces with underscores
            cleaned_key = "".join(c for c in cleaned if c.isalnum() or c.isspace() or c == '_').strip().replace(' ', '_').lower()
            if cleaned_key:
                 # Ensure unique keys if there are duplicates after cleaning
                unique_key = cleaned_key
                i = 1
                while unique_key in header_map.values():
                    i += 1
                    unique_key = f"{cleaned_key}_{i}"
                
                header_map[cleaned] = unique_key
                cleaned_headers.append(unique_key)
            else:
                # If header is empty, use a placeholder
                cleaned_headers.append(f"col_{len(cleaned_headers)}")

        df.columns = cleaned_headers[:len(df.columns)] # Use slice in case of extra columns/data

        # 2. Convert Data to List of Dictionaries (JSON format)
        # pd.to_json(orient='records') is efficient
        data_json = df.to_json(orient='records', date_format='iso')
        data_list = json.loads(data_json)
            
        sys.stderr.write(f"Python: Successfully extracted {len(data_list)} rows of data.\n")
            
        # SUCCESS CASE: Return structured JSON object
        return {
            "success": True, 
            "headers": cleaned_headers, 
            "data": data_list,
            "status": 200
        }
        
    except Exception as e:
        error_msg = f"An unexpected error occurred during file processing: {str(e)}"
        sys.stderr.write(error_msg + '\n')
        # If any pandas operation fails (e.g., trying to read a PDF as CSV), this generic 500 will catch it.
        return {"success": False, "error": error_msg, "status": 500}

# --- Main execution block ---
if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Use the first argument as the absolute file path
        file_path: str = sys.argv[1]
        result: Dict[str, Any] = extract_full_data(file_path)
        
        # Print JSON result to standard output for the calling process to capture
        print(json.dumps(result))
    else:
        # Argument error case
        sys.stderr.write("Usage: python extract_data.py <absolute_file_path>\n")
        print(json.dumps({"success": False, "error": "No file path provided to Python script.", "status": 400}))
