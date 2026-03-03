import os
import json
import getpass
import mysql.connector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "opportunities.json")

def export_opportunities():
    try:
        # Prompt for password without echoing to console
        pwd = getpass.getpass("Enter MySQL root password: ")
        
        # Connect to MySQL
        connection = mysql.connector.connect(
            host="localhost",
            user="root",
            password=pwd,  
            database="projects_db"
        )
        
        cursor = connection.cursor(dictionary=True)
        
        # We fetch opp_id as a unique identifier, and the text fields we care about
        query = """
            SELECT 
                opp_id, 
                number, 
                title, 
                description,
                url
            FROM 
                opportunities 
            WHERE 
                description IS NOT NULL 
                AND description != ''
        """
        
        print("Executing query...")
        cursor.execute(query)
        rows = cursor.fetchall()
        
        print(f"Found {len(rows)} opportunities with descriptions.")
        
        # Save to JSON
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
            
        print(f"Successfully saved to {OUTPUT_FILE}")
        
    except mysql.connector.Error as err:
        print(f"MySQL Error: {err}")
    finally:
        if 'connection' in locals() and connection.is_connected():
            cursor.close()
            connection.close()

if __name__ == "__main__":
    export_opportunities()
