# extract_headers.py - Updated to extract second row values and robust path handling
import pandas as pd
import sys
import json
import os
from typing import Dict, Any, List, Tuple
from pathlib import Path

def extract_headers_and_sample(file_path: str) -> Dict[str, Any]:
    """
    Extract column headers and second row sample values from the first sheet of an Excel file or CSV file.
    
    Args:
        file_path: The absolute path to the file (.xlsx, .xls, .csv).
        
    Returns:
        A dictionary containing the results:
        - {"success": True, "headers": List[str], "sample_values": Dict[str, str], "file_type": str, "status": 200} on success.
        - {"success": False, "error": str, "status": int} on failure.
    """
    
    # --- CRITICAL FIX: Robust Path Handling ---
    # Use pathlib to convert the received path (which may have mixed slashes or escaped backslashes) 
    # into a clean, system-native path object, and then convert to absolute path.
    # This should resolve the Errno 2 issue.
    try:
        # Resolve the path relative to the current working directory, then ensure it exists
        validated_file_path = str(Path(file_path).resolve())
        sys.stderr.write(f"Python: Validated file path: {validated_file_path}\\n")
        
        if not os.path.exists(validated_file_path):
            return {"success": False, "error": f"Validated file not found: {validated_file_path}", "status": 404}
            
        final_path = validated_file_path
        
    except Exception as e:
        sys.stderr.write(f"Python: Path validation failed for input '{file_path}': {str(e)}\\n")
        return {"success": False, "error": f"Path validation failed: {str(e)}", "status": 500}
        
    
    try:
        
        # Determine file type
        file_ext = os.path.splitext(final_path)[1].lower()
        file_type = ""
        
        # Read the file
        if file_ext in ['.xlsx', '.xls']:
            file_type = "excel"
            # Read first two rows: header (row 0) and sample data (row 1)
            # header=None prevents pandas from using the first row as headers yet
            df = pd.read_excel(final_path, header=None, nrows=2, engine='openpyxl')
        elif file_ext == '.csv':
            file_type = "csv"
            df = pd.read_csv(final_path, header=None, nrows=2)
        else:
            return {"success": False, "error": f"Unsupported file type: {file_ext}. Only .xlsx, .xls, and .csv are supported.", "status": 400}
        
        if df.empty:
            return {"success": False, "error": "The file is empty or could not be read.", "status": 400}
            
        # Separate headers (first row) and sample values (second row)
        # We ensure to drop columns that have no header name (NaN in the first row)
        header_row = df.iloc[0].dropna().astype(str)
        
        if header_row.empty:
            return {"success": False, "error": "The file contains no readable column headers.", "status": 400}
        
        # Identify the columns that were not dropped
        valid_indices = header_row.index
        
        # Get the second row data, only for columns with valid headers
        second_row = df.iloc[1].loc[valid_indices] if len(df) > 1 else pd.Series(index=valid_indices)

        cleaned_headers = []
        sample_values = {}

        # Iterate over the valid indices (columns with headers)
        for i in valid_indices:
            header = header_row.loc[i]
            
            # Clean header name
            cleaned_header = str(header).strip()
            
            if cleaned_header != '':
                # Map the cleaned header to its sample value from the second row
                # Use .get() in case the index doesn't exist in the (potentially shorter) second_row Series
                # Fill NaN values with an empty string
                sample_value = second_row.get(i)
                sample_values[cleaned_header] = str(sample_value).strip() if pd.notna(sample_value) else ""
                cleaned_headers.append(cleaned_header)

        sys.stderr.write(f"Python: Extracted sample values: {sample_values}\\n")
            
        # SUCCESS CASE: Return structured JSON object with file type and sample values
        return {
            "success": True, 
            "headers": cleaned_headers, 
            "sample_values": sample_values,
            "file_type": file_type,
            "status": 200
        }
        
    except ImportError as e:
        # Specifically catch pandas/openpyxl import errors
        error_msg = f"Missing Python dependency (pandas or openpyxl). Error: {str(e)}"
        sys.stderr.write(error_msg + '\\n')
        return {"success": False, "error": error_msg, "status": 500}
        
    except Exception as e:
        # UNEXPECTED FAILURE CASE: Catch any other uncaught errors
        error_msg = f"An unexpected error occurred during file processing: {str(e)}. Path used: {final_path}"
        sys.stderr.write(error_msg + '\\n')
        return {"success": False, "error": error_msg, "status": 500}

# ---
        
if __name__ == "__main__":
    # Get file path from command line arguments
    if len(sys.argv) > 1:
        file_path: str = sys.argv[1]
        result: Dict[str, Any] = extract_headers_and_sample(file_path)
        
        # Print JSON result to standard output for the calling process to capture
        print(json.dumps(result))
    else:
        # Argument failure case
        error_msg = "No file path provided as command line argument."
        sys.stderr.write(error_msg + '\\n')
        print(json.dumps({"success": False, "error": error_msg, "status": 400}))