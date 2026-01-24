# extract_headers.py - Updated for automated date format detection
import pandas as pd
import sys
import json
import os
import re
from typing import Dict, Any, List, Tuple, Optional
from pathlib import Path
from datetime import datetime

def detect_date_format(values: List[Any]) -> Optional[str]:
    """
    Analyzes a list of values to infer a common date format.
    Returns a MySQL-compatible format string or None.
    """
    # Filter out empty/null values and ensure strings
    clean_values = [str(v).strip() for v in values if pd.notna(v) and str(v).strip() != '']
    
    if not clean_values:
        return None

    # Patterns to check against
    # Python format -> MySQL format mapping
    patterns = [
        # DD/MM/YYYY or DD-MM-YYYY
        (r'^\d{1,2}[/-]\d{1,2}[/-]\d{4}$', '%d/%m/%Y', '%d-%m-%Y'),
        # MM/DD/YYYY (US) - Hard to distinguish from DD/MM without context, 
        # but we prioritize DD/MM/YYYY for non-US locales usually.
        # YYYY-MM-DD (ISO)
        (r'^\d{4}-\d{1,2}-\d{1,2}$', '%Y-%m-%d', '%Y-%m-%d'),
        # DD-Mon-YY or DD-Mon-YYYY (e.g., 25-Dec-23)
        (r'^\d{1,2}-[a-zA-Z]{3}-\d{2,4}$', '%d-%b-%y', '%d-%b-%Y'),
        # DD/MM/YY
        (r'^\d{1,2}[/-]\d{1,2}[/-]\d{2}$', '%d/%m/%y', '%d-%m-%y')
    ]

    # Heuristic: Check the first few values against patterns
    # We need a format that fits ALL (or most) non-empty values.
    
    candidate_format = None
    
    for val in clean_values[:5]: # Check first 5 non-empty values
        matched = False
        for regex, slash_fmt, dash_fmt in patterns:
            if re.match(regex, val):
                # Determine separator
                if '-' in val:
                    fmt = dash_fmt
                else:
                    fmt = slash_fmt
                
                # If we already have a candidate, check if it matches
                if candidate_format and candidate_format != fmt:
                    # Mixed formats? Abort or default to None
                    return None
                candidate_format = fmt
                matched = True
                break
        
        if not matched:
            # If a value doesn't match any known pattern, we can't auto-detect reliably
            return None

    # Refinement for Ambiguous DD/MM vs MM/DD
    # If format is %d/%m/%Y, check if any 'month' part > 12. 
    # If so, it might be %m/%d/%Y (US) effectively ruled out, or if 'day' > 12 it confirms DD first.
    if candidate_format in ['%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d-%m-%y']:
        max_first_part = 0
        max_second_part = 0
        
        for val in clean_values:
            parts = re.split(r'[/-]', val)
            if len(parts) >= 2:
                try:
                    p1 = int(parts[0])
                    p2 = int(parts[1])
                    max_first_part = max(max_first_part, p1)
                    max_second_part = max(max_second_part, p2)
                except:
                    continue
        
        # If first part > 12, it MUST be Day. (Format remains %d/...)
        # If second part > 12, it MUST be Day. (Format should switch to %m/%d...)
        if max_second_part > 12:
            # If second number is > 12, it's the day. So structure is MM/DD/...
            if candidate_format == '%d/%m/%Y': return '%m/%d/%Y'
            if candidate_format == '%d-%m-%Y': return '%m-%d-%Y'
            if candidate_format == '%d/%m/%y': return '%m/%d/%y'
            if candidate_format == '%d-%m-%y': return '%m-%d-%y'

    return candidate_format

def extract_headers_and_sample(file_path: str) -> Dict[str, Any]:
    try:
        validated_file_path = str(Path(file_path).resolve())
        
        if not os.path.exists(validated_file_path):
            return {"success": False, "error": f"Validated file not found: {validated_file_path}", "status": 404}
            
        final_path = validated_file_path
        
        # Determine file type and read more rows for analysis (e.g., 10 rows)
        file_ext = os.path.splitext(final_path)[1].lower()
        file_type = ""
        
        read_nrows = 15 # Read header + ~14 data rows
        
        if file_ext == '.xlsx':
            file_type = "excel"
            df = pd.read_excel(final_path, header=None, nrows=read_nrows, engine='openpyxl')
        elif file_ext == '.xls':
            file_type = "excel"
            df = pd.read_excel(final_path, header=None, nrows=read_nrows, engine='xlrd')
        elif file_ext == '.csv':
            file_type = "csv"
            df = pd.read_csv(final_path, header=None, nrows=read_nrows)
        else:
            return {"success": False, "error": f"Unsupported file type: {file_ext}", "status": 400}
        
        if df.empty:
            return {"success": False, "error": "The file is empty.", "status": 400}
            
        header_row = df.iloc[0].dropna().astype(str)
        if header_row.empty:
            return {"success": False, "error": "No readable column headers.", "status": 400}
        
        valid_indices = header_row.index
        
        # Get data rows (excluding header)
        data_rows = df.iloc[1:].loc[:, valid_indices] if len(df) > 1 else pd.DataFrame(columns=valid_indices)

        cleaned_headers = []
        sample_values = {}
        column_metadata = {}

        for i in valid_indices:
            header = str(header_row.loc[i]).strip()
            
            if header != '':
                cleaned_headers.append(header)
                
                # Get sample value from first data row (index 1 in original df, index 0 in data_rows if re-indexed)
                # data_rows index starts at 1.
                first_data_val = data_rows.loc[1, i] if 1 in data_rows.index else ""
                sample_values[header] = str(first_data_val).strip() if pd.notna(first_data_val) else ""
                
                # Metadata analysis
                col_values = data_rows[i].tolist()
                suggested_format = detect_date_format(col_values)
                
                if suggested_format:
                    column_metadata[header] = {
                        "suggested_mysql_format": suggested_format
                    }

        return {
            "success": True, 
            "headers": cleaned_headers, 
            "sample_values": sample_values,
            "column_metadata": column_metadata,
            "file_type": file_type,
            "status": 200
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "status": 500}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        file_path: str = sys.argv[1]
        result = extract_headers_and_sample(file_path)
        print(json.dumps(result))
    else:
        print(json.dumps({"success": False, "error": "No file path provided.", "status": 400}))